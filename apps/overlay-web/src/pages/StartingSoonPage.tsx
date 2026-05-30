import {
  BROADCAST_LEAGUE_TITLE,
  DEFAULT_GAME_START_LABEL,
  formatCountdownClock,
} from "@bpc/shared-types";
import type { ReactNode } from "react";

import { FadePanel, HudCanvas } from "../HudPrimitives";
import { useGameStartCountdown } from "../hooks/useGameStartCountdown";
import {
  GAME_START_TIMER_INNER_CLASS,
  GAME_START_TIMER_SHELL_CLASS,
} from "../overlay-layout";
import { useOverlayState } from "../OverlaySocketLayer";
import { routeVisible } from "../visibility";

function TimerCard({ children }: { children: ReactNode }) {
  return (
    <div className={GAME_START_TIMER_SHELL_CLASS}>
      <div className="relative z-10 flex w-full max-w-[40rem] flex-col items-center gap-6 text-center">
        {children}
      </div>
    </div>
  );
}

function LeagueFootnote() {
  return (
    <p className="game-start-league max-w-[36rem] font-body text-sm font-medium leading-snug tracking-wide text-neutral-400">
      <span className="text-neutral-500">— </span>
      <span className="text-neutral-100">{BROADCAST_LEAGUE_TITLE}</span>
    </p>
  );
}

export default function StartingSoonPage() {
  const { state } = useOverlayState();
  const visible = routeVisible("startingsoon", state);
  const cd = state.timers?.gameStartCountdown;
  const remaining = useGameStartCountdown(cd);
  const label = cd?.label?.trim() || DEFAULT_GAME_START_LABEL;
  const showCountdown = Boolean(cd && (cd.running || remaining > 0));

  return (
    <HudCanvas blend>
      <FadePanel show={visible}>
        <div className="flex h-full w-full items-center justify-center px-12">
          {showCountdown ? (
            <TimerCard>
              <p className="game-start-label max-w-[32rem] font-heading text-2xl font-bold uppercase tracking-[0.2em] text-white">
                {label}
              </p>
              <div className={GAME_START_TIMER_INNER_CLASS}>
                <p className="game-start-timer font-mono text-[7.5rem] font-black tabular-nums leading-none tracking-tight text-white">
                  {formatCountdownClock(remaining)}
                </p>
              </div>
              {remaining === 0 && cd?.running ? (
                <p className="game-start-go font-heading text-xl font-bold uppercase tracking-[0.28em] text-emerald-300">
                  Starting now
                </p>
              ) : null}
              <LeagueFootnote />
            </TimerCard>
          ) : state.timers?.startingSoonEta ? (
            <TimerCard>
              <p className="font-heading text-sm font-semibold uppercase tracking-[0.35em] text-neutral-400">
                Starting soon
              </p>
              <p className="game-start-timer font-mono text-6xl font-bold tabular-nums text-white">
                ETA {state.timers.startingSoonEta}
              </p>
              <LeagueFootnote />
            </TimerCard>
          ) : null}
        </div>
      </FadePanel>
    </HudCanvas>
  );
}
