import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  PlayerHeroLeagueStats,
  TournamentHeroAggregate,
} from "@bpc/shared-types";
import { env } from "../env.js";
import { logger } from "../logger.js";

export type LeaguePlayerHeroRow = {
  steam32: number;
  heroId: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  goldPerMin: number;
  lastHits: number;
  maxKills: number;
  laneWins: number;
  laneDraws: number;
  laneLosses: number;
};

export type LeagueStatsMeta = {
  leagueId: number;
  matchTotal: number;
  matchDone: number;
  aggregatedAt: string;
  source: "api" | "csv";
};

export type LeagueStatsSnapshot = {
  heroIndex: Record<string, TournamentHeroAggregate>;
  playerHeroes: LeaguePlayerHeroRow[];
  meta: LeagueStatsMeta;
};

function defaultLeagueStatsDirCandidates(): string[] {
  return [
    path.resolve(process.cwd(), "data/league-stats"),
    path.resolve(process.cwd(), "apps/broadcast-api/data/league-stats"),
  ];
}

/** Directory for league_{id}_heroes.csv (supports PM2 cwd at repo root or apps/broadcast-api). */
export function leagueStatsDir(): string {
  const configured = env.LEAGUE_STATS_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  const leagueId = env.LEAGUE_ID;
  for (const dir of defaultLeagueStatsDirCandidates()) {
    if (existsSync(path.join(dir, `league_${leagueId}_heroes.csv`))) {
      return dir;
    }
  }
  for (const dir of defaultLeagueStatsDirCandidates()) {
    if (existsSync(dir)) return dir;
  }
  return defaultLeagueStatsDirCandidates()[0];
}

export function leagueStatsCsvMissingPayload(leagueId: number) {
  const dir = leagueStatsDir();
  const paths = leagueStatsPaths(leagueId);
  return {
    code: "league_stats_csv_missing" as const,
    error: `No league stats CSV for league ${leagueId}. Click "fetch league stats" in admin (needs STEAM_WEB_API_KEY), or copy league_${leagueId}_heroes.csv into ${dir}`,
    leagueId,
    statsDir: dir,
    expectedFiles: [paths.heroes, paths.playerHeroes],
  };
}

export function leagueStatsCsvLoadFailedPayload(
  leagueId: number,
  statsStorage: Awaited<ReturnType<typeof leagueStatsFileInfo>>,
) {
  const dir = leagueStatsDir();
  const paths = leagueStatsPaths(leagueId);
  return {
    code: "league_stats_csv_load_failed" as const,
    error: `League CSV is on disk (${dir}) but could not be loaded into memory. Check file permissions and CSV format, then click "reload CSV".`,
    leagueId,
    statsDir: dir,
    expectedFiles: [paths.heroes, paths.playerHeroes],
    statsStorage,
  };
}

export function leagueStatsPaths(leagueId: number) {
  const dir = leagueStatsDir();
  return {
    dir,
    heroes: path.join(dir, `league_${leagueId}_heroes.csv`),
    playerHeroes: path.join(dir, `league_${leagueId}_player_heroes.csv`),
    meta: path.join(dir, `league_${leagueId}_meta.json`),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map(parseCsvLine);
}

function num(row: string[], idx: number, fallback = 0): number {
  const v = Number(row[idx]);
  return Number.isFinite(v) ? v : fallback;
}

function optNum(row: string[], idx: number): number | undefined {
  const v = Number(row[idx]);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Whether a match player row counts toward league player×hero stats.
 * Dotabuff keeps games with real K/D/A even when leaver_status is 1–2 (brief DC).
 * Excludes 0/0/0 and abandon/AFK (leaver_status ≥ 3).
 */
export function shouldCountPlayerLeagueGame(p: {
  leaver_status?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
}): boolean {
  const kills = p.kills ?? 0;
  const deaths = p.deaths ?? 0;
  const assists = p.assists ?? 0;
  if (kills === 0 && deaths === 0 && assists === 0) return false;
  if ((p.leaver_status ?? 0) >= 3) return false;
  return true;
}

/** Single-game row with 0/0/0 — typically a disconnect that should not count. */
export function isLeaverLikePlayerHeroRow(row: LeaguePlayerHeroRow): boolean {
  return (
    row.games === 1 &&
    row.kills === 0 &&
    row.deaths === 0 &&
    row.assists === 0
  );
}

export function filterLeaverLikePlayerHeroRows(
  rows: LeaguePlayerHeroRow[],
): LeaguePlayerHeroRow[] {
  return rows.filter((row) => !isLeaverLikePlayerHeroRow(row));
}

/** Sum all player×hero rows for one steam32 (total league games in CSV/index). */
export function summarizePlayerLeagueFromIndex(
  index: Record<string, PlayerHeroLeagueStats> | undefined,
  steam32: number,
): { games: number; wins: number } {
  if (!index || steam32 <= 0) return { games: 0, wins: 0 };
  const prefix = `${steam32}:`;
  let games = 0;
  let wins = 0;
  for (const [key, row] of Object.entries(index)) {
    if (!key.startsWith(prefix) || row.games <= 0) continue;
    games += row.games;
    wins += row.wins;
  }
  return { games, wins };
}

export function buildPlayerHeroIndex(
  rows: LeaguePlayerHeroRow[],
): Record<string, PlayerHeroLeagueStats> {
  const index: Record<string, PlayerHeroLeagueStats> = {};
  for (const row of rows) {
    if (row.games <= 0 || isLeaverLikePlayerHeroRow(row)) continue;
    const kda =
      row.deaths > 0
        ? (row.kills + row.assists) / row.deaths
        : row.kills + row.assists;
    index[`${row.steam32}:${row.heroId}`] = {
      games: row.games,
      wins: row.wins,
      winRate: row.wins / row.games,
      avgKills: row.kills / row.games,
      avgDeaths: row.deaths / row.games,
      avgAssists: row.assists / row.games,
      avgKda: kda,
      maxKills: row.maxKills,
      avgHeroDamage: row.heroDamage / row.games,
      avgGpm: row.goldPerMin / row.games,
      avgLastHits: row.lastHits / row.games,
      laneWins: row.laneWins,
      laneDraws: row.laneDraws,
      laneLosses: row.laneLosses,
    };
  }
  return index;
}

export async function loadLeagueStatsFromDisk(
  leagueId: number,
): Promise<LeagueStatsSnapshot | null> {
  const paths = leagueStatsPaths(leagueId);
  if (!(await fileExists(paths.heroes))) {
    return null;
  }

  try {
    const heroesText = await readFile(paths.heroes, "utf8");
    const heroRows = parseCsv(heroesText);
    if (heroRows.length < 2) return null;

    const heroIndex: Record<string, TournamentHeroAggregate> = {};
    for (const row of heroRows.slice(1)) {
      const heroId = num(row, 0);
      if (heroId <= 0) continue;
      heroIndex[String(heroId)] = {
        heroId,
        heroName: row[1] || undefined,
        picks: num(row, 2),
        bans: num(row, 3),
        wins: num(row, 4),
        losses: num(row, 5),
        games: num(row, 6),
        pickRate: optNum(row, 7),
        banRate: optNum(row, 8),
        winRate: optNum(row, 9),
        contestRate: optNum(row, 10),
      };
    }

    let playerHeroes: LeaguePlayerHeroRow[] = [];
    if (await fileExists(paths.playerHeroes)) {
      const playerText = await readFile(paths.playerHeroes, "utf8");
      const playerRows = parseCsv(playerText);
      for (const row of playerRows.slice(1)) {
        const steam32 = num(row, 0);
        const heroId = num(row, 1);
        if (steam32 <= 0 || heroId <= 0) continue;
        playerHeroes.push({
          steam32,
          heroId,
          games: num(row, 2),
          wins: num(row, 3),
          kills: num(row, 4),
          deaths: num(row, 5),
          assists: num(row, 6),
          heroDamage: num(row, 7),
          goldPerMin: num(row, 8),
          lastHits: num(row, 9),
          maxKills: num(row, 10),
          laneWins: num(row, 11),
          laneDraws: num(row, 12),
          laneLosses: num(row, 13),
        });
      }
      playerHeroes = filterLeaverLikePlayerHeroRows(playerHeroes);
    }

    let meta: LeagueStatsMeta = {
      leagueId,
      matchTotal: 0,
      matchDone: 0,
      aggregatedAt: new Date(0).toISOString(),
      source: "csv",
    };

    if (await fileExists(paths.meta)) {
      const raw = JSON.parse(await readFile(paths.meta, "utf8")) as LeagueStatsMeta;
      meta = { ...meta, ...raw, leagueId, source: "csv" };
    }

    return { heroIndex, playerHeroes, meta };
  } catch (err) {
    logger.warn({ err, leagueId }, "Failed to load league stats CSV");
    return null;
  }
}

export async function saveLeagueStatsToDisk(
  snapshot: LeagueStatsSnapshot,
): Promise<{ dir: string; paths: ReturnType<typeof leagueStatsPaths> }> {
  const { leagueId } = snapshot.meta;
  const paths = leagueStatsPaths(leagueId);
  await mkdir(paths.dir, { recursive: true });

  const heroHeader =
    "heroId,heroName,picks,bans,wins,losses,games,pickRate,banRate,winRate,contestRate";
  const heroLines = [heroHeader];
  for (const agg of Object.values(snapshot.heroIndex).sort(
    (a, b) => a.heroId - b.heroId,
  )) {
    heroLines.push(
      [
        agg.heroId,
        csvCell(agg.heroName ?? ""),
        agg.picks,
        agg.bans,
        agg.wins,
        agg.losses,
        agg.games,
        agg.pickRate ?? "",
        agg.banRate ?? "",
        agg.winRate ?? "",
        agg.contestRate ?? "",
      ].join(","),
    );
  }
  await writeFile(paths.heroes, `# BPC league hero stats — league ${leagueId}\n${heroLines.join("\n")}\n`, "utf8");

  const playerHeader =
    "steam32,heroId,games,wins,kills,deaths,assists,heroDamage,goldPerMin,lastHits,maxKills,laneWins,laneDraws,laneLosses";
  const playerLines = [playerHeader];
  for (const row of snapshot.playerHeroes.sort(
    (a, b) => a.steam32 - b.steam32 || a.heroId - b.heroId,
  )) {
    playerLines.push(
      [
        row.steam32,
        row.heroId,
        row.games,
        row.wins,
        row.kills,
        row.deaths,
        row.assists,
        row.heroDamage,
        row.goldPerMin,
        row.lastHits,
        row.maxKills,
        row.laneWins,
        row.laneDraws,
        row.laneLosses,
      ].join(","),
    );
  }
  await writeFile(
    paths.playerHeroes,
    `# BPC league player×hero stats — league ${leagueId}\n${playerLines.join("\n")}\n`,
    "utf8",
  );

  await writeFile(paths.meta, `${JSON.stringify(snapshot.meta, null, 2)}\n`, "utf8");

  return { dir: paths.dir, paths };
}

export async function leagueStatsFileInfo(leagueId: number) {
  const paths = leagueStatsPaths(leagueId);
  const [heroes, playerHeroes, meta] = await Promise.all([
    fileExists(paths.heroes),
    fileExists(paths.playerHeroes),
    fileExists(paths.meta),
  ]);
  return {
    dir: paths.dir,
    heroesPath: paths.heroes,
    playerHeroesPath: paths.playerHeroes,
    metaPath: paths.meta,
    heroesExists: heroes,
    playerHeroesExists: playerHeroes,
    metaExists: meta,
    ready: heroes,
  };
}
