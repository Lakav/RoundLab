import { describe, expect, it } from "vitest";
import {
  REPLAY_COLORS,
  teamColor,
  teamDarkColor,
} from "@/components/replay/map-renderer-colors";
import { THEME } from "@/lib/theme";

function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

describe("replay canvas colours", () => {
  it("draws each side with the same colour the HUD uses", () => {
    expect(teamColor(3)).toBe(hex(THEME.ct));
    expect(teamColor(2)).toBe(hex(THEME.t));
    expect(teamDarkColor(3)).toBe(hex(THEME.ctBg));
    expect(teamDarkColor(2)).toBe(hex(THEME.tBg));
  });

  it("falls back to a neutral colour for an unknown side", () => {
    expect(teamColor()).toBe(REPLAY_COLORS.neutral);
    expect(teamDarkColor()).toBe(REPLAY_COLORS.neutralDark);
  });

  it("keeps danger distinct from every side colour", () => {
    // The bomb carrier used to be painted with the fire colour, which made a
    // carrier and a molotov indistinguishable on the radar.
    expect(REPLAY_COLORS.danger).not.toBe(teamColor(2));
    expect(REPLAY_COLORS.danger).not.toBe(teamColor(3));
    expect(REPLAY_COLORS.danger).not.toBe(REPLAY_COLORS.he);
  });
});
