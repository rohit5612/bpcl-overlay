import { z } from "zod";

export const DEFAULT_GAME_START_LABEL = "Game starting in";

export const gameStartCountdownSchema = z.object({
  label: z.string().optional(),
  running: z.boolean(),
  /** Wall-clock end (ISO) while running — overlay derives seconds from this */
  endsAt: z.string().nullish(),
  /** Seconds left when paused, or preset before start */
  secondsRemaining: z.number().int().min(0),
});

/** Partial updates via PATCH /api/state */
export const gameStartCountdownPatchSchema = gameStartCountdownSchema.partial();

export type GameStartCountdown = z.infer<typeof gameStartCountdownSchema>;

export function gameStartCountdownRemaining(
  cd: GameStartCountdown | null | undefined,
  nowMs = Date.now(),
): number {
  if (!cd) return 0;
  if (cd.running && cd.endsAt) {
    const end = new Date(cd.endsAt).getTime();
    if (!Number.isFinite(end)) return Math.max(0, cd.secondsRemaining ?? 0);
    return Math.max(0, Math.ceil((end - nowMs) / 1000));
  }
  return Math.max(0, cd.secondsRemaining ?? 0);
}

/** Apply producer patch without inheriting stale endsAt / running defaults. */
export function mergeGameStartCountdown(
  prev: GameStartCountdown | undefined,
  patch: Partial<GameStartCountdown>,
  nowMs = Date.now(),
): GameStartCountdown {
  if (patch.running === true) {
    const seconds =
      patch.secondsRemaining ??
      (prev ? gameStartCountdownRemaining(prev, nowMs) : 0);
    const sec = Math.max(0, Math.floor(seconds));
    const label = patch.label ?? prev?.label ?? DEFAULT_GAME_START_LABEL;
    return {
      label,
      running: true,
      secondsRemaining: sec,
      endsAt: patch.endsAt ?? new Date(nowMs + sec * 1000).toISOString(),
    };
  }

  if (patch.running === false) {
    const seconds =
      patch.secondsRemaining ??
      (prev ? gameStartCountdownRemaining(prev, nowMs) : 0);
    return {
      label: patch.label ?? prev?.label ?? DEFAULT_GAME_START_LABEL,
      running: false,
      endsAt: null,
      secondsRemaining: Math.max(0, Math.floor(seconds)),
    };
  }

  const base: GameStartCountdown = {
    label: patch.label ?? prev?.label ?? DEFAULT_GAME_START_LABEL,
    running: prev?.running ?? false,
    endsAt: prev?.endsAt ?? null,
    secondsRemaining:
      patch.secondsRemaining ??
      (prev ? gameStartCountdownRemaining(prev, nowMs) : 0),
  };
  if (base.running && !base.endsAt) {
    const sec = Math.max(0, base.secondsRemaining);
    return {
      ...base,
      endsAt: new Date(nowMs + sec * 1000).toISOString(),
    };
  }
  if (!base.running) {
    return { ...base, endsAt: null };
  }
  return base;
}

export function formatCountdownClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function buildRunningGameStartCountdown(
  seconds: number,
  label = DEFAULT_GAME_START_LABEL,
): GameStartCountdown {
  const sec = Math.max(0, Math.floor(seconds));
  return {
    label,
    running: true,
    secondsRemaining: sec,
    endsAt: new Date(Date.now() + sec * 1000).toISOString(),
  };
}

export function buildPausedGameStartCountdown(
  seconds: number,
  label = DEFAULT_GAME_START_LABEL,
): GameStartCountdown {
  return {
    label,
    running: false,
    endsAt: null,
    secondsRemaining: Math.max(0, Math.floor(seconds)),
  };
}
