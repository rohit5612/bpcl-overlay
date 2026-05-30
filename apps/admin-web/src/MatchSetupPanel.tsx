import type { OverlayEnvelope } from "@bpc/shared-types";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, formatApiErrorBody } from "./api";

type TeamInfo = {
  teamKey: string;
  teamName: string;
  players: Array<{ displayName: string; steam32: number }>;
};

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  const cls =
    variant === "ghost"
      ? "border border-white/20 bg-transparent text-slate-300 hover:bg-white/5"
      : "bg-violet-600 text-white hover:bg-violet-500";
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

const selectClass =
  "w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white";

const EMPTY_PICK_PLAYERS: (number | null)[] = [null, null, null, null, null];

function normalizePickPlayers(
  raw: (number | null)[] | undefined,
): (number | null)[] {
  const out = [...EMPTY_PICK_PLAYERS];
  if (!raw) return out;
  for (let i = 0; i < 5; i++) out[i] = raw[i] ?? null;
  return out;
}

function PickSlotSelects({
  label,
  players,
  values,
  onChange,
}: {
  label: string;
  players: TeamInfo["players"];
  values: (number | null)[];
  onChange: (next: (number | null)[]) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mb-3 text-xs text-slate-400">
        Assign players to pick slots (shown on overlay after draft completes).
      </p>
      <div className="grid gap-2">
        {values.map((val, i) => (
          <select
            key={i}
            className={selectClass}
            value={val ?? ""}
            onChange={(e) => {
              const next = [...values];
              const v = e.target.value;
              next[i] = v ? Number(v) : null;
              onChange(next);
            }}
          >
            <option value="">Pick slot {i + 1} — unassigned</option>
            {players.map((p) => {
              const takenElsewhere = values.some(
                (v, j) => j !== i && v === p.steam32,
              );
              return (
                <option
                  key={p.steam32}
                  value={p.steam32}
                  disabled={takenElsewhere && val !== p.steam32}
                >
                  {p.displayName}
                </option>
              );
            })}
          </select>
        ))}
      </div>
    </div>
  );
}

export function MatchSetupPanel({
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
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [radiantKey, setRadiantKey] = useState("");
  const [direKey, setDireKey] = useState("");
  const [seriesBestOf, setSeriesBestOf] = useState<1 | 3 | 5>(3);
  const [seriesGame, setSeriesGame] = useState(1);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [stageLabel, setStageLabel] = useState("");
  const [radiantPickPlayers, setRadiantPickPlayers] = useState<(number | null)[]>(
    () => [...EMPTY_PICK_PLAYERS],
  );
  const [direPickPlayers, setDirePickPlayers] = useState<(number | null)[]>(
    () => [...EMPTY_PICK_PLAYERS],
  );
  const [busy, setBusy] = useState(false);
  const pickPlayersDirtyRef = useRef(false);
  const matchSetupDirtyRef = useRef(false);

  const matchSetup = state?.leagueConfig?.matchSetup;
  const roster = state?.leagueConfig?.roster ?? [];
  const teamColors = state?.leagueConfig?.teamColors ?? {};

  useEffect(() => {
    if (!token.trim() || roster.length === 0) {
      setTeams([]);
      return;
    }
    void apiFetch(origin, token, "/api/teams")
      .then((r) => r.json())
      .then((list: TeamInfo[]) => setTeams(list))
      .catch(() => setTeams([]));
  }, [origin, token, roster.length, state?.updatedAt]);

  // Sync teams/scores from server. Do not depend on pickPlayers arrays — live
  // STATE_FULL snapshots clone them every tick and would reset unsaved edits.
  useEffect(() => {
    if (matchSetupDirtyRef.current) return;
    if (matchSetup?.radiantTeamKey) setRadiantKey(matchSetup.radiantTeamKey);
    if (matchSetup?.direTeamKey) setDireKey(matchSetup.direTeamKey);
    if (matchSetup?.seriesBestOf) setSeriesBestOf(matchSetup.seriesBestOf);
    if (matchSetup?.seriesGame) setSeriesGame(matchSetup.seriesGame);
    if (matchSetup?.scoreA !== undefined) setScoreA(matchSetup.scoreA);
    if (matchSetup?.scoreB !== undefined) setScoreB(matchSetup.scoreB);
    if (matchSetup?.stageLabel !== undefined) setStageLabel(matchSetup.stageLabel);
  }, [
    matchSetup?.radiantTeamKey,
    matchSetup?.direTeamKey,
    matchSetup?.seriesBestOf,
    matchSetup?.seriesGame,
    matchSetup?.scoreA,
    matchSetup?.scoreB,
    matchSetup?.stageLabel,
  ]);

  const serverRadiantPickPlayers = JSON.stringify(
    matchSetup?.pickPlayers?.radiant ?? EMPTY_PICK_PLAYERS,
  );
  const serverDirePickPlayers = JSON.stringify(
    matchSetup?.pickPlayers?.dire ?? EMPTY_PICK_PLAYERS,
  );

  useEffect(() => {
    if (pickPlayersDirtyRef.current) return;
    if (matchSetup?.pickPlayers?.radiant) {
      setRadiantPickPlayers(
        normalizePickPlayers(matchSetup.pickPlayers.radiant),
      );
    }
    if (matchSetup?.pickPlayers?.dire) {
      setDirePickPlayers(normalizePickPlayers(matchSetup.pickPlayers.dire));
    }
  }, [serverRadiantPickPlayers, serverDirePickPlayers]);

  const maxSeriesGame = seriesBestOf;
  const gameOptions = Array.from({ length: maxSeriesGame }, (_, i) => i + 1);

  useEffect(() => {
    if (seriesGame > maxSeriesGame) setSeriesGame(maxSeriesGame);
  }, [seriesGame, maxSeriesGame]);

  const radiantTeam = useMemo(
    () => teams.find((t) => t.teamKey === radiantKey),
    [teams, radiantKey],
  );
  const direTeam = useMemo(
    () => teams.find((t) => t.teamKey === direKey),
    [teams, direKey],
  );

  async function applyPlayerMapping() {
    setBusy(true);
    try {
      const r = await apiFetch(origin, token, "/api/match/apply-player-mapping", {
        method: "POST",
        body: JSON.stringify({
          pickPlayers: {
            radiant: radiantPickPlayers,
            dire: direPickPlayers,
          },
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        setErr(formatApiErrorBody(t));
        return;
      }
      pickPlayersDirtyRef.current = false;
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applySetup() {
    if (!radiantKey || !direKey) return;
    setBusy(true);
    try {
      const r = await apiFetch(origin, token, "/api/match/setup", {
        method: "POST",
        body: JSON.stringify({
          radiantTeamKey: radiantKey,
          direTeamKey: direKey,
          seriesBestOf,
          seriesGame,
          scoreA,
          scoreB,
          stageLabel: stageLabel.trim() || undefined,
          pickPlayers: {
            radiant: radiantPickPlayers,
            dire: direPickPlayers,
          },
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        setErr(formatApiErrorBody(t));
        return;
      }
      pickPlayersDirtyRef.current = false;
      matchSetupDirtyRef.current = false;
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-violet-500/40 bg-violet-950/25 p-6">
      <h2 className="text-lg font-semibold text-violet-200">Match setup</h2>
      <p className="mt-2 text-xs text-slate-400">
        Upload roster first (include optional{" "}
        <code className="text-violet-300">teamColor</code> hex per row), then
        choose which two teams are playing and assign Radiant / Dire before the
        draft starts. Logos use each team&apos;s{" "}
        <code className="text-violet-300">teamKey</code> from the CSV.
      </p>

      {roster.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No roster loaded yet.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase text-slate-500">
                Radiant team
              </label>
              <select
                className={selectClass}
                value={radiantKey}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setRadiantKey(e.target.value);
                }}
              >
                <option value="">— select team —</option>
                {teams.map((t) => (
                  <option key={t.teamKey} value={t.teamKey}>
                    {t.teamName} ({t.teamKey})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">
                Dire team
              </label>
              <select
                className={selectClass}
                value={direKey}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setDireKey(e.target.value);
                }}
              >
                <option value="">— select team —</option>
                {teams.map((t) => (
                  <option key={t.teamKey} value={t.teamKey}>
                    {t.teamName} ({t.teamKey})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-xs uppercase text-slate-500">
                Series format
              </label>
              <select
                className={selectClass}
                value={seriesBestOf}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setSeriesBestOf(Number(e.target.value) as 1 | 3 | 5);
                }}
              >
                <option value={1}>Best of 1</option>
                <option value={3}>Best of 3</option>
                <option value={5}>Best of 5</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">
                Game in series
              </label>
              <select
                className={selectClass}
                value={seriesGame}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setSeriesGame(Number(e.target.value));
                }}
              >
                {gameOptions.map((g) => (
                  <option key={g} value={g}>
                    Game {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">
                Radiant series wins
              </label>
              <input
                type="number"
                min={0}
                max={seriesBestOf}
                className={selectClass}
                value={scoreA}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setScoreA(Math.max(0, Number(e.target.value) || 0));
                }}
              />
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">
                Dire series wins
              </label>
              <input
                type="number"
                min={0}
                max={seriesBestOf}
                className={selectClass}
                value={scoreB}
                onChange={(e) => {
                  matchSetupDirtyRef.current = true;
                  setScoreB(Math.max(0, Number(e.target.value) || 0));
                }}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs uppercase text-slate-500">
              Overlay stage label (right side of draft bar)
            </label>
            <input
              type="text"
              className={`${selectClass} mt-1`}
              placeholder="Quarter finals 1"
              value={stageLabel}
              onChange={(e) => {
                matchSetupDirtyRef.current = true;
                setStageLabel(e.target.value);
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn
              disabled={
                busy ||
                !radiantKey ||
                !direKey ||
                radiantKey === direKey
              }
              onClick={() => void applySetup()}
            >
              apply match setup
            </Btn>
            <Btn
              variant="ghost"
              disabled={
                busy ||
                !matchSetup ||
                state?.draft?.phase !== "done"
              }
              onClick={() => void applyPlayerMapping()}
            >
              apply player mapping to overlay
            </Btn>
          </div>

          {state?.production?.playerMappingPublished ? (
            <p className="mt-2 text-xs text-emerald-400">
              Player names are live on the draft overlay.
            </p>
          ) : state?.draft?.phase === "done" ? (
            <p className="mt-2 text-xs text-amber-400">
              Draft complete — click “apply player mapping” when pick slots are final.
            </p>
          ) : null}

          {matchSetup ? (
            <p className="mt-3 text-xs text-emerald-400">
              Active: {matchSetup.radiantTeamKey} (Radiant) vs{" "}
              {matchSetup.direTeamKey} (Dire) · BO{matchSetup.seriesBestOf ?? 3}{" "}
              game {matchSetup.seriesGame ?? 1}
              {matchSetup.scoreA || matchSetup.scoreB
                ? ` · ${matchSetup.scoreA ?? 0}–${matchSetup.scoreB ?? 0}`
                : ""}
              {matchSetup.stageLabel
                ? ` · “${matchSetup.stageLabel}”`
                : ""}
            </p>
          ) : null}

          {(radiantTeam || direTeam) && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {radiantTeam ? (
                <PickSlotSelects
                  label={`${radiantTeam.teamName} — Radiant pick slots`}
                  players={radiantTeam.players}
                  values={radiantPickPlayers}
                  onChange={(next) => {
                    pickPlayersDirtyRef.current = true;
                    setRadiantPickPlayers(next);
                  }}
                />
              ) : null}
              {direTeam ? (
                <PickSlotSelects
                  label={`${direTeam.teamName} — Dire pick slots`}
                  players={direTeam.players}
                  values={direPickPlayers}
                  onChange={(next) => {
                    pickPlayersDirtyRef.current = true;
                    setDirePickPlayers(next);
                  }}
                />
              ) : null}
            </div>
          )}

          {(radiantTeam || direTeam) && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {radiantTeam ? (
                <TeamRosterPreview
                  label="Radiant roster"
                  team={radiantTeam}
                  teamColor={teamColors[radiantTeam.teamKey]}
                />
              ) : null}
              {direTeam ? (
                <TeamRosterPreview
                  label="Dire roster"
                  team={direTeam}
                  teamColor={teamColors[direTeam.teamKey]}
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TeamRosterPreview({
  label,
  team,
  teamColor,
}: {
  label: string;
  team: TeamInfo;
  teamColor?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="font-semibold text-white">
        {team.teamName}{" "}
        <span className="text-slate-500">/teams/{team.teamKey}.png</span>
      </p>
      {teamColor ? (
        <p className="mt-1 text-xs text-slate-400">
          Color from CSV:{" "}
          <span
            className="inline-block h-3 w-3 rounded-sm align-middle"
            style={{ backgroundColor: teamColor }}
          />{" "}
          {teamColor}
        </p>
      ) : null}
      <ul className="mt-2 space-y-1 text-sm text-slate-300">
        {team.players.map((p) => (
          <li key={p.steam32}>
            {p.displayName}{" "}
            <span className="text-slate-600">({p.steam32})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
