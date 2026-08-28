import { THEME } from "@/lib/theme";

/**
 * Single source of colour for the PixiJS canvas.
 *
 * The HUD consumes `THEME` directly as CSS strings; the canvas needs the same
 * values as numbers. Deriving them here keeps a CT player the same blue in the
 * HUD and on the radar, instead of the two near-identical blues that appeared
 * when the renderer defined its own literals.
 */
function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

export const REPLAY_COLORS = {
  ct: hex(THEME.ct),
  ctDark: hex(THEME.ctBg),
  t: hex(THEME.t),
  tDark: hex(THEME.tBg),
  neutral: 0xe5e7eb,
  neutralDark: 0x303030,

  /** Reserved for actual danger: fire and the bomb itself. */
  danger: 0xef4444,

  he: 0xf97316,
  flash: 0xfef3c7,
  smoke: 0x9ca3af,
  decoy: 0xa78bfa,
  utility: 0x6fea76,

  ink: 0x000000,
  surface: 0x1d1f1f,
  label: 0xe8edeb,
  labelDim: 0x9aa5a1,
} as const;

/** Opacity steps, so alive/dead and near/far stay consistent across sprites. */
export const REPLAY_ALPHA = {
  full: 1,
  strong: 0.95,
  ring: 0.9,
  ringTrack: 0.2,
  outline: 0.45,
  dead: 0.5,
  faint: 0.28,
} as const;

export function teamColor(team?: number): number {
  if (team === 3) return REPLAY_COLORS.ct;
  if (team === 2) return REPLAY_COLORS.t;
  return REPLAY_COLORS.neutral;
}

export function teamDarkColor(team?: number): number {
  if (team === 3) return REPLAY_COLORS.ctDark;
  if (team === 2) return REPLAY_COLORS.tDark;
  return REPLAY_COLORS.neutralDark;
}
