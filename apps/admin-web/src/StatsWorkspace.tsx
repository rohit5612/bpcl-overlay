import type { OverlayEnvelope } from "@bpc/shared-types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, formatApiErrorBody } from "./api";
import { HeroSearchSelect, type HeroMeta } from "./HeroSearchSelect";

const selectClass =
  "w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white";

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
}) {
  const cls =
    variant === "danger"
      ? "border border-rose-500/50 bg-rose-950/60 text-rose-200 hover:bg-rose-900/60"
      : variant === "ghost"
        ? "border border-white/20 bg-transparent text-slate-300 hover:bg-white/5"
        : "bg-emerald-600 text-white hover:bg-emerald-500";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

function StopBtn({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Btn variant="danger" disabled={disabled} onClick={onClick}>
      stop
    </Btn>
  );
}

export function StatsWorkspace({
  origin,
  token,
  state,
  setErr,
  onShowOverlay,
}: {
  origin: string;
  token: string;
  state: OverlayEnvelope | null;
  setErr: (e: string | null) => void;
  onShowOverlay: (route: string, seconds?: number) => Promise<void>;
}) {
  const [leagueInfo, setLeagueInfo] = useState<{
    statsDir?: string;
    statsStorage?: {
      dir?: string;
      heroesExists?: boolean;
      playerHeroesExists?: boolean;
      ready?: boolean;
    };
    steamApiConfigured?: boolean;
  } | null>(null);
  const [leagueId, setLeagueId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [heroes, setHeroes] = useState<HeroMeta[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [selectedHero, setSelectedHero] = useState("");
  const [heroA, setHeroA] = useState("");
  const [heroB, setHeroB] = useState("");
  const [tournamentHero, setTournamentHero] = useState("");
  const [carouselHero, setCarouselHero] = useState("");
  const [busy, setBusy] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [resolveReport, setResolveReport] = useState<{
    missingSteam32?: number[];
    rosterCount?: number;
    csvPlayerCount?: number;
    indexKeyCount?: number;
    matchedRosterCount?: number;
    indexEmpty?: string;
  } | null>(null);

  const roster = state?.leagueConfig?.roster ?? [];
  const matchSetup = state?.leagueConfig?.matchSetup;
  const activeRoster = matchSetup
    ? roster.filter(
        (p) =>
          p.teamKey === matchSetup.radiantTeamKey ||
          p.teamKey === matchSetup.direTeamKey,
      )
    : roster;
  const lc = state?.leagueConfig;

  const post = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      setBusy(true);
      try {
        const r = await apiFetch(origin, token, path, {
          method: "POST",
          body: JSON.stringify(body ?? {}),
        });
        const t = await r.text();
        if (!r.ok) {
          setErr(formatApiErrorBody(t));
          return null;
        }
        setErr(null);
        return t ? (JSON.parse(t) as unknown) : null;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [origin, token, setErr],
  );

  useEffect(() => {
    if (!token.trim()) return;
    void apiFetch(origin, token, "/api/heroes")
      .then((r) => r.json())
      .then((list: HeroMeta[]) => setHeroes(list))
      .catch(() => undefined);
  }, [origin, token]);

  useEffect(() => {
    if (!token.trim()) return;
    void apiFetch(origin, token, "/api/league/info")
      .then((r) => r.json())
      .then(
        (info: {
          leagueId?: number;
          statsDir?: string;
          statsStorage?: {
            dir?: string;
            heroesExists?: boolean;
            playerHeroesExists?: boolean;
            ready?: boolean;
          };
          steamApiConfigured?: boolean;
        }) => {
          if (info.leagueId != null) setLeagueId(String(info.leagueId));
          setLeagueInfo(info);
        },
      )
      .catch(() => undefined);
  }, [origin, token]);

  useEffect(() => {
    if (lc?.leagueId != null) setLeagueId(String(lc.leagueId));
  }, [lc?.leagueId]);

  useEffect(() => {
    if (lc?.aggregationStatus === "ready" || lc?.aggregationStatus === "error") {
      setAggBusy(false);
    }
  }, [lc?.aggregationStatus]);

  const [aggBusy, setAggBusy] = useState(false);

  const pollStatus = useCallback(async () => {
    const r = await apiFetch(origin, token, "/api/league/aggregate/status");
    if (!r.ok) return;
    const body = (await r.json()) as { inMemoryRunning?: boolean };
    setAggBusy(Boolean(body.inMemoryRunning));
  }, [origin, token]);

  useEffect(() => {
    const aggregating =
      lc?.aggregationStatus === "running" || aggBusy;
    if (!aggregating) return undefined;
    const id = setInterval(() => void pollStatus(), 2000);
    return () => clearInterval(id);
  }, [lc?.aggregationStatus, aggBusy, pollStatus]);

  const playerSteam32 = activeRoster.find(
    (p) => p.displayName === selectedPlayer,
  )?.steam32;

  const stopHeroStats = useCallback(
    () => void post("/api/stats/stop"),
    [post],
  );

  return (
    <section className="space-y-8 rounded-2xl border border-sky-500/40 bg-slate-900/80 p-6">
      <h2 className="text-lg font-semibold text-sky-300">Stats & League</h2>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold uppercase text-slate-400">League</h3>
          <p className="text-xs text-slate-500">
            Stats are loaded from <strong className="text-sky-300">CSV on disk</strong> by
            default (no API calls). Use fetch only when you need fresh data after new
            matches.
          </p>
          {lc?.aggregationSource ? (
            <p className="text-xs text-slate-400">
              Loaded from:{" "}
              <span className="text-sky-300">{lc.aggregationSource.toUpperCase()}</span>
              {lc.aggregatedAt ? ` · ${new Date(lc.aggregatedAt).toLocaleString()}` : ""}
            </p>
          ) : null}
          {leagueInfo?.statsStorage ? (
            <p className="text-xs text-slate-500">
              CSV:{" "}
              {leagueInfo.statsStorage.heroesExists ? (
                <span className="text-emerald-400">heroes file found</span>
              ) : (
                <span className="text-amber-400">no heroes CSV yet</span>
              )}
              {leagueInfo.statsStorage.playerHeroesExists ? (
                <span className="text-emerald-400"> · player×hero file found</span>
              ) : (
                <span className="text-amber-400"> · no player×hero CSV (needed for roster resolve)</span>
              )}
              {leagueInfo.statsDir ? (
                <>
                  {" "}
                  · <code className="text-sky-300/80">{leagueInfo.statsDir}</code>
                </>
              ) : null}
            </p>
          ) : null}
          {leagueInfo?.statsStorage?.heroesExists &&
          lc?.aggregationStatus !== "ready" ? (
            <p className="text-xs text-sky-300/90">
              Files are on disk but not loaded into the API yet — click{" "}
              <strong>reload CSV</strong>, then <strong>resolve stats</strong> after
              roster upload.
            </p>
          ) : null}
          {!leagueInfo?.steamApiConfigured ? (
            <p className="text-xs text-amber-400">
              <code className="text-sky-300">STEAM_WEB_API_KEY</code> in{" "}
              <code className="text-sky-300">apps/broadcast-api/.env</code> is required to
              list league matches from Steam.
            </p>
          ) : null}
          <div>
            <label className="text-xs uppercase text-slate-500">League ID</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-400"
              value={leagueId}
              readOnly
              placeholder="from LEAGUE_ID env"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() => void post("/api/league/stats/reload-csv")}
            >
              reload CSV
            </Btn>
            <Btn
              disabled={
                busy ||
                !leagueId ||
                lc?.aggregationStatus === "running" ||
                aggBusy
              }
              onClick={() => {
                setAggBusy(true);
                void post("/api/league/aggregate").then(() => void pollStatus());
              }}
            >
              {lc?.aggregationStatus === "running" || aggBusy
                ? "fetching…"
                : "fetch league stats"}
            </Btn>
          </div>
          {lc?.aggregationStatus !== "ready" && lc?.aggregationStatus !== "running" && !aggBusy ? (
            <p className="text-xs text-amber-400">
              No stats loaded yet — click <strong>fetch league stats</strong> once
              (takes ~1–2 min for 33 matches), or <strong>reload CSV</strong> if files
              exist.
            </p>
          ) : null}
          {lc ? (
            <div className="text-xs text-slate-400">
              <p>status: {lc.aggregationStatus}</p>
              {typeof lc.aggregationProgress === "number" ? (
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${lc.aggregationProgress}%` }}
                    />
                  </div>
                  <p className="mt-1">
                    {lc.aggregationMatchDone ?? 0} / {lc.aggregationMatchTotal ?? "?"} matches
                  </p>
                </div>
              ) : null}
              {lc.aggregationError ? (
                <p className="mt-2 text-red-400">{lc.aggregationError}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold uppercase text-slate-400">Roster CSV</h3>
          <p className="text-xs text-slate-500">
            displayName,steam32,teamName,teamKey,teamColor[,avatarUrl] — avatars auto-fetched from Steam on upload, or paste image URLs in CSV.
            teamColor is optional hex (e.g. #5b8fd4) for draft overlay accents.
          </p>
          <textarea
            className="min-h-[100px] w-full rounded-lg border border-white/10 bg-black/70 p-3 font-mono text-xs"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="displayName,steam32,teamName,teamKey,teamColor"
          />
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then(setCsvText);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !csvText.trim()}
              onClick={() => void post("/api/roster/upload", { csv: csvText })}
            >
              upload roster
            </Btn>
            <Btn
              variant="ghost"
              disabled={busy || roster.length === 0}
              onClick={() =>
                void post("/api/league/stats/resolve").then((data) => {
                  if (data && typeof data === "object") {
                    setResolveReport(data as typeof resolveReport);
                  }
                })
              }
            >
              resolve stats
            </Btn>
          </div>
          {resolveReport ? (
            <p
              className={`text-xs ${
                (resolveReport.missingSteam32?.length ?? 0) === 0
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
            >
              Stats resolved: {resolveReport.indexKeyCount ?? 0} index keys ·{" "}
              {resolveReport.csvPlayerCount ?? 0} players in CSV ·{" "}
              {resolveReport.matchedRosterCount ?? 0}/
              {resolveReport.rosterCount ?? 0} roster matched
              {resolveReport.indexEmpty ? (
                <span className="block text-rose-400">{resolveReport.indexEmpty}</span>
              ) : null}
              {(resolveReport.missingSteam32?.length ?? 0) > 0 ? (
                <span className="block text-amber-300/90">
                  No league stats for {resolveReport.missingSteam32!.length} roster
                  steam32 (not in league CSV or no games played in league{" "}
                  {leagueId || "—"})
                </span>
              ) : (
                " · all roster steam32 matched"
              )}
            </p>
          ) : null}
          {roster.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                {roster.length} player{roster.length === 1 ? "" : "s"} loaded
              </p>
              {rosterExpanded ? (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-1">name</th>
                      <th>steam32</th>
                      <th>team</th>
                      <th>key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((p) => (
                      <tr key={p.steam32} className="border-t border-white/5">
                        <td className="py-1">{p.displayName}</td>
                        <td>{p.steam32}</td>
                        <td>{p.teamName ?? "—"}</td>
                        <td>{p.teamKey ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <button
                type="button"
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
                onClick={() => setRosterExpanded((v) => !v)}
              >
                {rosterExpanded ? "Show less" : `Show roster (${roster.length})`}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-purple-500/30 bg-purple-950/20 p-4">
          <h3 className="text-sm font-semibold text-purple-200">Player + hero</h3>
          <select
            className={selectClass}
            value={selectedPlayer}
            onChange={(e) => setSelectedPlayer(e.target.value)}
          >
            <option value="">— player —</option>
            {activeRoster.map((p) => (
              <option key={p.steam32} value={p.displayName}>
                {p.displayName}
                {p.teamName ? ` (${p.teamName})` : ""}
              </option>
            ))}
          </select>
          <HeroSearchSelect
            heroes={heroes}
            value={selectedHero}
            onChange={setSelectedHero}
            placeholder="— hero —"
          />
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !selectedHero || playerSteam32 === undefined || lc?.aggregationStatus !== "ready"}
              onClick={() =>
                void post("/api/stats/player-hero", {
                  steam32: playerSteam32,
                  heroId: Number(selectedHero),
                  persist: true,
                }).then(() => onShowOverlay("herostats", 12))
              }
            >
              show on overlay
            </Btn>
            <Btn
              variant="ghost"
              disabled={busy || !selectedHero || playerSteam32 === undefined}
              onClick={() =>
                void post("/api/stats/carousel", {
                  type: "player-hero",
                  steam32: playerSteam32,
                  heroId: Number(selectedHero),
                })
              }
            >
              3-slide carousel
            </Btn>
            <StopBtn disabled={busy} onClick={stopHeroStats} />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
          <h3 className="text-sm font-semibold text-sky-200">Player (league)</h3>
          <p className="text-xs text-slate-400">
            Tournament-wide stats for a player across all heroes in the current league.
          </p>
          <select
            className={selectClass}
            value={selectedPlayer}
            onChange={(e) => setSelectedPlayer(e.target.value)}
          >
            <option value="">— player —</option>
            {activeRoster.map((p) => (
              <option key={`league-${p.steam32}`} value={p.displayName}>
                {p.displayName}
                {p.teamName ? ` (${p.teamName})` : ""}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={
                busy ||
                !selectedPlayer ||
                playerSteam32 === undefined ||
                lc?.aggregationStatus !== "ready"
              }
              onClick={() =>
                void post("/api/stats/player-league", {
                  steam32: playerSteam32,
                  persist: true,
                }).then(() => onShowOverlay("herostats", 12))
              }
            >
              show on overlay
            </Btn>
            <StopBtn disabled={busy} onClick={stopHeroStats} />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
          <h3 className="text-sm font-semibold text-emerald-200">Tournament hero</h3>
          <HeroSearchSelect
            heroes={heroes}
            value={tournamentHero}
            onChange={setTournamentHero}
            placeholder="— hero —"
          />
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !tournamentHero}
              onClick={() =>
                void post("/api/stats/tournament-hero", {
                  heroId: Number(tournamentHero),
                  persist: true,
                }).then(() => onShowOverlay("herostats", 12))
              }
            >
              show tournament stats
            </Btn>
            <StopBtn disabled={busy} onClick={stopHeroStats} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-4">
          <h3 className="text-sm font-semibold text-rose-200">Matchup</h3>
          <HeroSearchSelect
            heroes={heroes}
            value={heroA}
            onChange={setHeroA}
            placeholder="hero A"
          />
          <HeroSearchSelect
            heroes={heroes}
            value={heroB}
            onChange={setHeroB}
            placeholder="hero B"
          />
          <Btn
            disabled={busy || !heroA || !heroB}
            onClick={() =>
              void post("/api/stats/matchup", {
                heroAId: Number(heroA),
                heroBId: Number(heroB),
                persist: true,
              }).then(() => onShowOverlay("matchup", 12))
            }
          >
            show matchup overlay
          </Btn>
        </div>

        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
          <h3 className="text-sm font-semibold text-amber-200">Carousel spotlight</h3>
          <HeroSearchSelect
            heroes={heroes}
            value={carouselHero}
            onChange={setCarouselHero}
            placeholder="any hero"
          />
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !carouselHero}
              onClick={() =>
                void post("/api/stats/carousel", {
                  type: "tournament-hero",
                  heroId: Number(carouselHero),
                  overlaySeconds: 12,
                })
              }
            >
              run carousel (12s)
            </Btn>
            <StopBtn disabled={busy} onClick={stopHeroStats} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function GsiDraftControls({
  origin,
  token,
  state,
  setErr,
}: {
  origin: string;
  token: string;
  state: OverlayEnvelope | null;
  setErr: (e: string | null) => void;
}) {
  const [manualHero, setManualHero] = useState("");
  const [heroes, setHeroes] = useState<HeroMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const prod = state?.production;
  const lastPick = state?.draft?.lastPick;

  const post = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await apiFetch(origin, token, path, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      const t = await r.text();
      if (!r.ok) {
        setErr(t.slice(0, 400));
        return;
      }
      setErr(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token.trim()) return;
    void apiFetch(origin, token, "/api/heroes")
      .then((r) => r.json())
      .then((list: HeroMeta[]) => setHeroes(list))
      .catch(() => undefined);
  }, [origin, token]);

  return (
    <section className="rounded-2xl border border-orange-500/40 bg-orange-950/25 p-6">
      <h2 className="text-lg font-semibold text-orange-200">GSI Draft</h2>
      <p className="mt-2 text-xs text-slate-400">
        Install <code className="text-orange-300">infra/docs/GSI.cfg</code> → Dota{" "}
        <code>gamestate_integration_bpc.cfg</code> · POST http://127.0.0.1:8080/gsi
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <span className={prod?.gsiConnected ? "text-emerald-400" : "text-slate-500"}>
          GSI {prod?.gsiConnected ? "connected" : "idle"}
        </span>
        {prod?.gsiLastSeen ? (
          <span className="text-xs text-slate-500">last seen {prod.gsiLastSeen}</span>
        ) : null}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={prod?.autoShowStatsOnPick ?? false}
            onChange={(e) =>
              void post("/api/production/settings", {
                autoShowStatsOnPick: e.target.checked,
              })
            }
          />
          auto-show stats on pick
        </label>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                "Clear overlay draft cache? Removes draft picks and reveal state on OBS.",
              )
            ) {
              return;
            }
            void post("/api/draft/reset-overlay");
          }}
        >
          clear overlay draft cache
        </Btn>
        {prod?.playerMappingPublished ? (
          <span className="text-xs text-emerald-400">Player mapping published</span>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold text-slate-300">Last pick stats</h3>
          {lastPick ? (
            <p className="mt-2 text-sm text-slate-400">
              {lastPick.playerName ?? "?"} · {lastPick.heroName ?? `#${lastPick.heroId}`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No pick yet</p>
          )}
          <button
            type="button"
            className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"
            disabled={!lastPick}
            onClick={() =>
              void post("/api/stats/carousel", { type: "last-pick", overlaySeconds: 12 })
            }
          >
            stats for last pick
          </button>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold text-slate-300">Manual hero spotlight</h3>
          <div className="mt-2">
            <HeroSearchSelect
              heroes={heroes}
              value={manualHero}
              onChange={setManualHero}
              placeholder="— hero —"
            />
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"
            disabled={!manualHero}
            onClick={() =>
              void post("/api/stats/carousel", {
                type: "tournament-hero",
                heroId: Number(manualHero),
                overlaySeconds: 12,
              })
            }
          >
            show carousel
          </button>
        </div>
      </div>
    </section>
  );
}
