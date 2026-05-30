/**
 * Bottom reserve on 1080p OBS sources so stats panels clear the draft blast bar
 * (bans + picks + center hub + labels).
 */
/** Clears draft blast bar + title strip above it */
export const DRAFT_BOTTOM_SAFE_PX = 532;

export const STATS_PANEL_SHELL_CLASS =
  "rounded-2xl bg-gradient-to-br from-slate-900/95 to-purple-950/90 p-6 ring-2 ring-purple-400/60 shadow-xl backdrop-blur";

export const PLAYER_STATS_SHELL_CLASS =
  "rounded-2xl bg-black/85 p-6 ring-2 ring-cyan-400/60 shadow-xl backdrop-blur-xl";

/** Game-start panel (static gradient — see index.css `.game-start-*`) */
export const GAME_START_TIMER_SHELL_CLASS = "game-start-card px-16 py-12";
export const GAME_START_TIMER_INNER_CLASS = "game-start-inner px-10 py-6";
