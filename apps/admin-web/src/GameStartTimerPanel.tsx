import type { OverlayEnvelope } from "@bpc/shared-types";
import {
  DEFAULT_GAME_START_LABEL,
  formatCountdownClock,
  gameStartCountdownRemaining,
} from "@bpc/shared-types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { apiFetch, formatApiErrorBody } from "./api";
import { routeVisible } from "./visibility";

function parseMmSs(mmSs: string): number {
  const t = mmSs.trim();
  if (!t) return 0;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    return Math.max(0, (Number(m) || 0) * 60 + (Number(s) || 0));
  }
  return Math.max(0, Math.floor(Number(t) || 0));
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  const cls =
    variant === "ghost"
      ? "border border-white/20 bg-transparent text-slate-300 hover:bg-white/5"
      : "bg-sky-600 text-white hover:bg-sky-500";
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

const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white";

export function GameStartTimerPanel({
  state,
  busy,
  setBusy,
  setErr,
  origin,
  token,
  onVisibility,
}: {
  state: OverlayEnvelope | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setErr: (e: string | null) => void;
  origin: string;
  token: string;
  onVisibility: (visible: boolean) => Promise<void>;
}) {
  const cd = state?.timers?.gameStartCountdown;

  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  void tick;
  const displayRemaining = gameStartCountdownRemaining(cd);

  const [label, setLabel] = useState(DEFAULT_GAME_START_LABEL);
  const [mmSs, setMmSs] = useState("05:00");

  useEffect(() => {
    if (cd?.label) setLabel(cd.label);
  }, [cd?.label]);

  useEffect(() => {
    if (!cd) return;
    if (cd.running) {
      setMmSs(formatCountdownClock(gameStartCountdownRemaining(cd)));
    }
  }, [cd?.running, cd?.endsAt, cd?.secondsRemaining]);

  const overlayOn = routeVisible("startingsoon", state);

  async function timerPost(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(origin, token, path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) {
        setErr(formatApiErrorBody(t));
        return;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-sky-500/40 bg-sky-950/25 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-sky-200">Game start timer</h2>
          <p className="mt-1 text-xs text-slate-400">
            OBS browser source:{" "}
            <code className="text-sky-300">/startingsoon</code> — uses server
            clock when you click start.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => void onVisibility(e.target.checked)}
          />
          show overlay
        </label>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs uppercase text-slate-500">Label</label>
          <input
            className={`${inputClass} mt-1`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={DEFAULT_GAME_START_LABEL}
          />
        </div>
        <div>
          <label className="text-xs uppercase text-slate-500">
            Time (mm:ss or seconds)
          </label>
          <input
            className={`${inputClass} mt-1 font-mono`}
            value={mmSs}
            onChange={(e) => setMmSs(e.target.value)}
            placeholder="05:00"
          />
        </div>
      </div>

      <p className="mt-4 font-mono text-2xl text-white">
        Live: {formatCountdownClock(displayRemaining)}
        <span className="ml-3 text-sm text-slate-500">
          {cd?.running ? "running" : "paused"}
        </span>
        {cd?.endsAt ? (
          <span className="mt-1 block text-xs text-slate-600">
            ends {new Date(cd.endsAt).toLocaleTimeString()}
          </span>
        ) : null}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Btn
          disabled={busy}
          onClick={() =>
            void timerPost("/api/timers/game-start/start", {
              seconds: parseMmSs(mmSs),
              label: label.trim() || DEFAULT_GAME_START_LABEL,
            })
          }
        >
          start
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy || !cd?.running}
          onClick={() =>
            void timerPost("/api/timers/game-start/pause", {
              seconds: displayRemaining,
              label: label.trim() || DEFAULT_GAME_START_LABEL,
            })
          }
        >
          pause
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void timerPost("/api/timers/game-start/set", {
              seconds: parseMmSs(mmSs),
              label: label.trim() || DEFAULT_GAME_START_LABEL,
            })
          }
        >
          apply time
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void timerPost("/api/timers/game-start/pause", {
              seconds: 0,
              label: label.trim() || DEFAULT_GAME_START_LABEL,
            })
          }
        >
          reset
        </Btn>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Click <strong className="text-sky-300">start</strong> after setting time
        (server sets the deadline). <strong>Apply time</strong> adjusts while
        running or paused.
      </p>
    </section>
  );
}
