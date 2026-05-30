import { readFile } from "node:fs/promises";
import type { Express } from "express";
import type { Server as IOServer } from "socket.io";
import { z } from "zod";
import {
  matchSetupSchema,
  manualPickSteam32,
  pickPlayersSchema,
  pickSlotOrderForHero,
} from "@bpc/shared-types";
import type { StateManager } from "@bpc/state-manager";
import { requireBroadcastAuth } from "./auth-middleware.js";
import { env } from "./env.js";
import type { OpenDotaClient } from "./opendota-client.js";
import type { BroadcastFns } from "./routes.js";
import {
  bootstrapLeagueFromEnv,
  leagueInfoFromEnv,
  loadLeagueStatsFromCsvFile,
  runLeagueAggregation,
} from "./services/league-bootstrap.js";
import {
  leagueStatsCsvLoadFailedPayload,
  leagueStatsCsvMissingPayload,
  leagueStatsDir,
  leagueStatsFileInfo,
  summarizePlayerLeagueFromIndex,
} from "./services/league-stats-store.js";
import {
  assertLeagueStatsReady,
  LeagueStatsNotReadyError,
} from "./services/league-stats-guard.js";
import { parseRosterCsv, teamColorsFromRoster } from "./services/roster-parser.js";
import { listTeamsFromRoster } from "./services/roster-teams.js";
import {
  applyPickPlayersToDraft,
  draftPatchFromMatchSetup,
} from "./services/match-setup.js";
import { enrichRosterAvatars } from "./services/steam-profile.js";
import { tournamentAggregator } from "./services/tournament-aggregator.js";
import {
  buildCarouselFromHeroCard,
  buildMatchupCard,
  buildPlayerHeroCard,
  buildPlayerLeagueCard,
  buildTournamentHeroCard,
  findRosterPlayer,
  listHeroesForAdmin,
} from "./services/stats-builder.js";

function leagueStatsError(res: import("express").Response, err: unknown): boolean {
  if (err instanceof LeagueStatsNotReadyError) {
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

export function attachLeagueAndStatsRoutes(opts: {
  app: Express;
  state: StateManager;
  io: IOServer;
  broadcast: BroadcastFns;
  opendota: OpenDotaClient;
}): void {
  const { app, state, broadcast, opendota } = opts;

  app.get("/api/league/info", requireBroadcastAuth, async (_req, res) => {
    const snap = await state.getState();
    const csvInfo = await leagueStatsFileInfo(env.LEAGUE_ID);
    res.json({
      ...leagueInfoFromEnv(),
      configuredInEnv: true,
      leagueConfig: snap.leagueConfig,
      playerStatsScope: "league_only",
      statsStorage: csvInfo,
      steamApiConfigured: Boolean(env.STEAM_WEB_API_KEY),
      envMatchIdsConfigured: Boolean(env.LEAGUE_MATCH_IDS?.trim()),
    });
  });

  app.post("/api/league/config", requireBroadcastAuth, async (_req, res) => {
    res.status(400).json({
      error: `League ID is set via LEAGUE_ID env (${env.LEAGUE_ID}). Update .env and restart the API.`,
    });
  });

  app.post("/api/league/aggregate", requireBroadcastAuth, async (_req, res) => {
    if (tournamentAggregator.isBusy()) {
      return res.json({ ok: true, started: false, alreadyRunning: true });
    }

    const snap = await state.getState();
    if (snap.leagueConfig?.aggregationStatus === "running") {
      await state.patchState({
        leagueConfig: {
          leagueId: env.LEAGUE_ID,
          aggregationStatus: "idle",
          aggregationError: undefined,
        },
      });
    }

    void runLeagueAggregation({
      leagueId: env.LEAGUE_ID,
      state,
      opendota,
      broadcast,
    });

    res.json({ ok: true, started: true, leagueId: env.LEAGUE_ID });
  });

  app.post(
    "/api/league/stats/reload-csv",
    requireBroadcastAuth,
    async (_req, res) => {
      const ok = await loadLeagueStatsFromCsvFile({
        leagueId: env.LEAGUE_ID,
        state,
        broadcast,
      });
      if (!ok) {
        const csvInfo = await leagueStatsFileInfo(env.LEAGUE_ID);
        const payload = csvInfo.heroesExists
          ? leagueStatsCsvLoadFailedPayload(env.LEAGUE_ID, csvInfo)
          : { ...leagueStatsCsvMissingPayload(env.LEAGUE_ID), statsStorage: csvInfo };
        return res.status(422).json(payload);
      }
      const snap = await state.getState();
      res.json({ ok: true, leagueConfig: snap.leagueConfig });
    },
  );

  app.get(
    "/api/league/stats/storage",
    requireBroadcastAuth,
    async (_req, res) => {
      const info = await leagueStatsFileInfo(env.LEAGUE_ID);
      const snap = await state.getState();
      res.json({
        ...info,
        statsDir: leagueInfoFromEnv().statsDir,
        aggregationSource: snap.leagueConfig?.aggregationSource,
        aggregatedAt: snap.leagueConfig?.aggregatedAt,
      });
    },
  );

  app.get(
    "/api/league/aggregate/status",
    requireBroadcastAuth,
    async (_req, res) => {
      const prog = tournamentAggregator.getProgress();
      const snap = await state.getState();
      res.json({
        ...prog,
        inMemoryRunning: tournamentAggregator.isBusy(),
        leagueId: env.LEAGUE_ID,
        leagueConfig: snap.leagueConfig,
      });
    },
  );

  app.post("/api/roster/upload", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({ csv: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const parsedRoster = parseRosterCsv(parsed.data.csv);
    const roster = await enrichRosterAvatars(parsedRoster, opendota);
    const teamColors = teamColorsFromRoster(roster);
    const next = await state.patchState({
      leagueConfig: { roster, teamColors, leagueId: env.LEAGUE_ID },
    });
    await broadcast.broadcastFull(next);
    res.json({ ok: true, count: roster.length, teamColors, roster });
  });

  app.get("/api/roster", requireBroadcastAuth, async (_req, res) => {
    const snap = await state.getState();
    res.json(snap.leagueConfig?.roster ?? []);
  });

  app.get("/api/teams", requireBroadcastAuth, async (_req, res) => {
    const snap = await state.getState();
    const roster = snap.leagueConfig?.roster ?? [];
    res.json(listTeamsFromRoster(roster));
  });

  app.post("/api/match/setup", requireBroadcastAuth, async (req, res) => {
    const parsed = matchSetupSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const snap = await state.getState();
    const roster = snap.leagueConfig?.roster ?? [];
    if (roster.length === 0) {
      return res.status(400).json({ error: "upload roster first" });
    }

    const { seriesBestOf, seriesGame } = parsed.data;
    if (seriesGame > seriesBestOf) {
      return res.status(400).json({
        error: `Game ${seriesGame} is invalid for a BO${seriesBestOf} series`,
      });
    }

    try {
      const matchSetup = parsed.data;
      const draftSeed = draftPatchFromMatchSetup(
        matchSetup,
        roster,
        snap.draft,
      );
      const next = await state.patchState({
        leagueConfig: { matchSetup },
        draft: draftSeed,
        production: {
          playerMappingPublished: false,
        },
      });
      await broadcast.broadcastFull(next);
      res.json({
        ok: true,
        matchSetup,
        teams: listTeamsFromRoster(roster),
        draft: next.draft,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post(
    "/api/league/stats/resolve",
    requireBroadcastAuth,
    async (_req, res) => {
      const snap = await state.getState();
      const roster = snap.leagueConfig?.roster ?? [];
      if (roster.length === 0) {
        return res.status(400).json({ error: "upload roster first" });
      }

      const csvInfo = await leagueStatsFileInfo(env.LEAGUE_ID);
      const loaded = await loadLeagueStatsFromCsvFile({
        leagueId: env.LEAGUE_ID,
        state,
        broadcast,
      });
      if (!loaded) {
        const payload = csvInfo.heroesExists
          ? leagueStatsCsvLoadFailedPayload(env.LEAGUE_ID, csvInfo)
          : { ...leagueStatsCsvMissingPayload(env.LEAGUE_ID), statsStorage: csvInfo };
        return res.status(422).json(payload);
      }

      const after = await state.getState();
      const index = after.playerHeroIndex ?? {};
      const indexKeyCount = Object.keys(index).length;
      const missingSteam32: number[] = [];
      for (const player of roster) {
        const prefix = `${player.steam32}:`;
        const hasRow = Object.keys(index).some((k) => k.startsWith(prefix));
        if (!hasRow) missingSteam32.push(player.steam32);
      }

      const csvSteam32 = new Set(
        Object.keys(index).map((k) => Number(k.split(":")[0])),
      );

      const sampleSteam32 = roster[0]?.steam32;
      const sampleGames =
        sampleSteam32 != null
          ? summarizePlayerLeagueFromIndex(index, sampleSteam32).games
          : 0;

      res.json({
        ok: true,
        loaded: true,
        rosterCount: roster.length,
        csvPlayerCount: csvSteam32.size,
        indexKeyCount,
        matchedRosterCount: roster.length - missingSteam32.length,
        missingSteam32,
        statsStorage: csvInfo,
        indexEmpty:
          indexKeyCount === 0
            ? "playerHeroIndex not in memory — rebuild @bpc/state-manager and restart API"
            : undefined,
        sampleRosterGamesInIndex: sampleGames,
        leagueConfig: after.leagueConfig,
      });
    },
  );

  app.get(
    "/api/league/player/:steam32/stats-audit",
    requireBroadcastAuth,
    async (req, res) => {
      const steam32 = Number(req.params.steam32);
      if (!Number.isFinite(steam32) || steam32 <= 0) {
        return res.status(400).json({ error: "invalid steam32" });
      }

      const snap = await state.getState();
      const index = snap.playerHeroIndex ?? {};
      const prefix = `${steam32}:`;
      const heroRows = Object.entries(index)
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, row]) => ({
          heroId: Number(k.split(":")[1]),
          games: row.games,
          wins: row.wins,
        }));
      const total = summarizePlayerLeagueFromIndex(index, steam32);

      const paths = await leagueStatsFileInfo(env.LEAGUE_ID);
      let csvLines: string[] = [];
      try {
        const csvText = await readFile(paths.playerHeroesPath, "utf8");
        csvLines = csvText
          .split(/\r?\n/)
          .filter((l) => l.startsWith(`${steam32},`));
      } catch {
        csvLines = [];
      }
      const csvGamesSum = csvLines.reduce(
        (n, line) => n + (Number(line.split(",")[2]) || 0),
        0,
      );

      res.json({
        steam32,
        leagueId: env.LEAGUE_ID,
        gamesInIndex: total.games,
        winsInIndex: total.wins,
        heroRows,
        csvRowCount: csvLines.length,
        csvGamesSum,
        aggregationMatchTotal: snap.leagueConfig?.aggregationMatchTotal,
        hint:
          total.games === 0
            ? "No league rows in memory — Resolve stats or Fetch league stats"
            : total.games < csvGamesSum
              ? "Index out of sync — click Resolve stats"
              : "If below Dotabuff, re-fetch league stats (latest match may be missing from CSV)",
      });
    },
  );

  app.post(
    "/api/match/apply-player-mapping",
    requireBroadcastAuth,
    async (req, res) => {
      const bodyParsed = z
        .object({ pickPlayers: pickPlayersSchema.optional() })
        .safeParse(req.body ?? {});
      if (!bodyParsed.success) {
        return res.status(400).json({ error: bodyParsed.error.flatten() });
      }

      const snap = await state.getState();
      const baseMatchSetup = snap.leagueConfig?.matchSetup;
      const roster = snap.leagueConfig?.roster ?? [];
      const draft = snap.draft;

      if (!baseMatchSetup) {
        return res.status(400).json({ error: "save match setup first" });
      }
      if (!draft) {
        return res.status(400).json({ error: "no draft state" });
      }
      if (draft.phase !== "done") {
        return res.status(400).json({
          error: "draft must be complete before applying player mapping",
        });
      }

      const incomingPickPlayers = bodyParsed.data.pickPlayers;
      const matchSetup = incomingPickPlayers
        ? {
            ...baseMatchSetup,
            pickPlayers: {
              radiant:
                incomingPickPlayers.radiant ??
                baseMatchSetup.pickPlayers?.radiant,
              dire:
                incomingPickPlayers.dire ?? baseMatchSetup.pickPlayers?.dire,
            },
          }
        : baseMatchSetup;

      const leagueConfig = {
        ...snap.leagueConfig!,
        roster,
        matchSetup,
      };
      const mappedDraft = applyPickPlayersToDraft(draft, leagueConfig);

      const next = await state.patchState({
        leagueConfig: { matchSetup },
        draft: mappedDraft,
        production: {
          playerMappingPublished: true,
        },
      });
      await broadcast.broadcastFull(next);
      res.json({
        ok: true,
        matchSetup: next.leagueConfig?.matchSetup,
        draft: next.draft,
        production: next.production,
      });
    },
  );

  app.post(
    "/api/draft/reset-overlay",
    requireBroadcastAuth,
    async (_req, res) => {
      const snap = await state.getState();
      const roster = snap.leagueConfig?.roster ?? [];
      const matchSetup = snap.leagueConfig?.matchSetup;
      const epoch = (snap.production?.overlayDraftEpoch ?? 0) + 1;

      let draft = null;
      if (matchSetup && roster.length > 0) {
        draft = draftPatchFromMatchSetup(
          matchSetup,
          roster,
          null,
        ) as import("@bpc/shared-types").DraftState;
      }

      const next = await state.patchState({
        draft,
        heroStatsCard: null,
        statCarousel: null,
        production: {
          playerMappingPublished: false,
          overlayDraftEpoch: epoch,
        },
      });
      await broadcast.broadcastFull(next);
      res.json({
        ok: true,
        overlayDraftEpoch: epoch,
        draft: next.draft,
      });
    },
  );

  app.post("/api/league/team-colors", requireBroadcastAuth, async (_req, res) => {
    res.status(410).json({
      error:
        "Team colors are set from the roster CSV teamColor column. Re-upload roster to change colors.",
    });
  });

  app.get("/api/heroes", requireBroadcastAuth, async (_req, res) => {
    const heroes = await listHeroesForAdmin(opendota);
    res.json(heroes);
  });

  app.post("/api/stats/player-hero", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      steam32: z.number(),
      heroId: z.number(),
      displayName: z.string().optional(),
      persist: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const snap = await state.getState();
    try {
      assertLeagueStatsReady(snap);
    } catch (err) {
      if (leagueStatsError(res, err)) return;
      throw err;
    }

    const roster = snap.leagueConfig?.roster ?? [];
    const player =
      findRosterPlayer(roster, parsed.data.steam32) ??
      ({
        steam32: parsed.data.steam32,
        displayName: parsed.data.displayName ?? `Player ${parsed.data.steam32}`,
      } as const);

    const card = await buildPlayerHeroCard(
      opendota,
      parsed.data.steam32,
      parsed.data.heroId,
      player.displayName,
      snap.tournamentHeroIndex ?? {},
      roster,
      snap.playerHeroIndex,
    );

    if (parsed.data.persist) {
      const next = await state.patchState({
        heroStatsCard: card,
        statCarousel: null,
      });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, card, persisted: next });
    }
    res.json({ ok: true, card });
  });

  app.post("/api/stats/player-league", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      steam32: z.number(),
      displayName: z.string().optional(),
      persist: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const snap = await state.getState();
    try {
      assertLeagueStatsReady(snap);
    } catch (err) {
      if (leagueStatsError(res, err)) return;
      throw err;
    }

    const roster = snap.leagueConfig?.roster ?? [];
    const player =
      findRosterPlayer(roster, parsed.data.steam32) ??
      ({
        steam32: parsed.data.steam32,
        displayName: parsed.data.displayName ?? `Player ${parsed.data.steam32}`,
      } as const);

    const card = await buildPlayerLeagueCard(
      opendota,
      parsed.data.steam32,
      player.displayName,
      snap.playerHeroIndex,
      roster,
    );

    if (parsed.data.persist) {
      const next = await state.patchState({
        heroStatsCard: card,
        statCarousel: null,
      });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, card, persisted: next });
    }
    res.json({ ok: true, card });
  });

  app.post(
    "/api/stats/tournament-hero",
    requireBroadcastAuth,
    async (req, res) => {
      const schema = z.object({
        heroId: z.number(),
        persist: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });

      const snap = await state.getState();
      try {
        assertLeagueStatsReady(snap);
      } catch (err) {
        if (leagueStatsError(res, err)) return;
        throw err;
      }

      const card = await buildTournamentHeroCard(
        opendota,
        parsed.data.heroId,
        snap.tournamentHeroIndex ?? {},
      );

      if (parsed.data.persist) {
        const next = await state.patchState({
          heroStatsCard: card,
          statCarousel: null,
        });
        await broadcast.broadcastFull(next);
        return res.json({ ok: true, card, persisted: next });
      }
      res.json({ ok: true, card });
    },
  );

  app.post("/api/stats/matchup", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      heroAId: z.number(),
      heroBId: z.number(),
      persist: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const card = await buildMatchupCard(
      opendota,
      parsed.data.heroAId,
      parsed.data.heroBId,
    );

    if (parsed.data.persist) {
      const next = await state.patchState({ matchupCard: card });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, card, persisted: next });
    }
    res.json({ ok: true, card });
  });

  app.post("/api/stats/carousel", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      type: z.enum(["player-hero", "tournament-hero", "last-pick"]),
      heroId: z.number().optional(),
      steam32: z.number().optional(),
      slideDurationMs: z.number().optional(),
      overlaySeconds: z.number().optional(),
      persist: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const snap = await state.getState();
    try {
      assertLeagueStatsReady(snap);
    } catch (err) {
      if (leagueStatsError(res, err)) return;
      throw err;
    }

    const roster = snap.leagueConfig?.roster ?? [];
    let card;

    if (parsed.data.type === "last-pick") {
      const lp = snap.draft?.lastPick;
      if (!lp) return res.status(400).json({ error: "no last pick" });
      const side = lp.side === "dire" || lp.side === "B" ? "dire" : "radiant";
      const teamSlots =
        side === "radiant"
          ? snap.draft?.radiant?.slots
          : snap.draft?.dire?.slots;
      const slotOrder = pickSlotOrderForHero(side, lp.heroId, teamSlots);
      const manualSteam32 =
        slotOrder !== undefined
          ? manualPickSteam32(snap.leagueConfig?.matchSetup, side, slotOrder)
          : undefined;
      const player =
        manualSteam32 != null && manualSteam32 > 0
          ? findRosterPlayer(roster, manualSteam32)
          : undefined;

      card =
        player && manualSteam32
          ? await buildPlayerHeroCard(
              opendota,
              manualSteam32,
              lp.heroId,
              player.displayName,
              snap.tournamentHeroIndex ?? {},
              roster,
              snap.playerHeroIndex,
            )
          : await buildTournamentHeroCard(
              opendota,
              lp.heroId,
              snap.tournamentHeroIndex ?? {},
            );
    } else if (parsed.data.type === "player-hero") {
      if (parsed.data.heroId === undefined || parsed.data.steam32 === undefined)
        return res.status(400).json({ error: "steam32 and heroId required" });
      const player = findRosterPlayer(roster, parsed.data.steam32);
      card = await buildPlayerHeroCard(
        opendota,
        parsed.data.steam32,
        parsed.data.heroId,
        player?.displayName ?? "Player",
        snap.tournamentHeroIndex ?? {},
        roster,
        snap.playerHeroIndex,
      );
    } else {
      if (parsed.data.heroId === undefined)
        return res.status(400).json({ error: "heroId required" });
      card = await buildTournamentHeroCard(
        opendota,
        parsed.data.heroId,
        snap.tournamentHeroIndex ?? {},
      );
    }

    const carousel = buildCarouselFromHeroCard(
      card,
      parsed.data.slideDurationMs ?? 4000,
    );
    const until =
      Date.now() + (parsed.data.overlaySeconds ?? 12) * 1000;

    if (parsed.data.persist !== false) {
      const next = await state.patchState({
        heroStatsCard: card,
        statCarousel: carousel,
        overlayVisibility: {
          herostats: { mode: "timed", until },
        },
      });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, card, carousel, persisted: next });
    }
    res.json({ ok: true, card, carousel });
  });

  app.post("/api/stats/stop", requireBroadcastAuth, async (_req, res) => {
    const next = await state.patchState({
      statCarousel: null,
      heroStatsCard: null,
      overlayVisibility: {
        herostats: "hidden",
      },
    });
    await broadcast.broadcastFull(next);
    res.json({ ok: true, persisted: next });
  });

  app.post("/api/production/settings", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      autoShowStatsOnPick: z.boolean().optional(),
      playerMappingPublished: z.boolean().optional(),
      overlayDraftEpoch: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const next = await state.patchState({ production: parsed.data });
    await broadcast.broadcastFull(next);
    res.json(next.production);
  });
}

export { bootstrapLeagueFromEnv };
