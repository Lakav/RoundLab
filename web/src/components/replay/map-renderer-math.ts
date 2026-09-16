import type { Frame, PlayerId } from "@/lib/types";

export function lastKnownTeams(frames: Frame[], time: number): Map<PlayerId, number> {
  const teams = new Map<PlayerId, number>();
  for (const frame of frames) {
    if (frame.t > time) break;
    for (const player of frame.players) teams.set(player.id, player.team);
  }
  return teams;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function easeOutCubic(value: number): number {
  const time = clamp01(value);
  return 1 - Math.pow(1 - time, 3);
}

export function mixColor(from: number, to: number, amount: number): number {
  const time = clamp01(amount);
  const fromRed = (from >> 16) & 0xff;
  const fromGreen = (from >> 8) & 0xff;
  const fromBlue = from & 0xff;
  const toRed = (to >> 16) & 0xff;
  const toGreen = (to >> 8) & 0xff;
  const toBlue = to & 0xff;
  return (
    (Math.round(fromRed + (toRed - fromRed) * time) << 16) |
    (Math.round(fromGreen + (toGreen - fromGreen) * time) << 8) |
    Math.round(fromBlue + (toBlue - fromBlue) * time)
  );
}

export function heightLift(z: number): number {
  // Stronger than before so a lobbed grenade actually reads as an arc on the
  // radar; still capped so a high ledge does not fly off its own footprint.
  return Math.max(0, Math.min(34, Math.abs(z) / 26));
}
