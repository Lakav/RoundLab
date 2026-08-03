import { describe, expect, it } from "vitest";
import { iconPathFor } from "@/lib/icons";
import { THEME, sideColors } from "@/lib/theme";

describe("replay presentation helpers", () => {
  it("normalizes known weapon and utility names", () => {
    expect(iconPathFor(" weapon_AK47 ")).toBe("/icons/ak47.svg");
    expect(iconPathFor("custom smoke projectile")).toBe("/icons/smokegrenade.svg");
    expect(iconPathFor("burningflames")).toBe("/icons/burning-flames.svg");
    expect(iconPathFor("burningflammes")).toBe("/icons/burning-flames.svg");
    expect(iconPathFor("world")).toBeNull();
    expect(iconPathFor()).toBeNull();
    expect(iconPathFor("bad/path")).toBeNull();
    expect(iconPathFor("custom_item")).toBe("/icons/custom_item.svg");
  });

  it("returns the complete side palette", () => {
    expect(sideColors("CT")).toEqual({
      accent: THEME.ct,
      soft: THEME.ctSoft,
      bg: THEME.ctBg,
      bgDark: THEME.ctBgDark,
      money: THEME.ctMoney,
    });
    expect(sideColors("T").accent).toBe(THEME.t);
  });
});
