import { z } from "zod";

export const DEFAULT_GAME_START_LABEL = "Game starting in";

export const gameStartCountdownSchema = z.object({
  label: z.string().optional(),
  running: z.boolean().default(false),
  /** Wall-clock end (ISO) while running — overlay derives seconds from this */
  endsAt: z.string().optional(),
  /** Seconds left when paused, or preset before start */
  secondsRemaining: z.number().int().min(0).default(0),
});

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
    endsAt: undefined,
    secondsRemaining: Math.max(0, Math.floor(seconds)),
  };
}
