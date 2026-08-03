// cs2lens-inspired palette.
export const THEME = {
  chrome: "#181818",
  panel: "#222222",
  borderDashed: "#444444",
  borderSolid: "#383838",
  textBright: "#ffffff",
  textMuted: "#a0a0a0",
  textDim: "#8f8f8f",
  textDead: "#464646",

  ct: "#47cbff",
  ctSoft: "#8fddff",
  ctBg: "#195066",
  ctBgDark: "#133c4d",
  ctMoney: "#3f9dc2",

  t: "#ffaf47",
  tSoft: "#ffc36f",
  tBg: "#795322",
  tBgDark: "#5b3e19",
  tMoney: "#b88749",

  accent: "#90ee90",
  danger: "#f55",
  brand: "#aceeff",
} as const;

export function sideColors(side: "CT" | "T") {
  if (side === "CT") {
    return {
      accent: THEME.ct,
      soft: THEME.ctSoft,
      bg: THEME.ctBg,
      bgDark: THEME.ctBgDark,
      money: THEME.ctMoney,
    };
  }
  return {
    accent: THEME.t,
    soft: THEME.tSoft,
    bg: THEME.tBg,
    bgDark: THEME.tBgDark,
    money: THEME.tMoney,
  };
}
