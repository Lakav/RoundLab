const WEAPON_ICON_MAP: Record<string, string | null> = {
  "ak-47": "ak47",
  "ak47": "ak47",
  "weapon_ak47": "ak47",
  "m4a4": "m4a1",
  "m4a1": "m4a1_silencer",
  "weapon_m4a1": "m4a1_silencer",
  "m4a1_silencer": "m4a1_silencer",
  "weapon_m4a1_silencer": "m4a1_silencer",
  "m4a1-s": "m4a1_silencer",
  "awp": "awp",
  "ssg 08": "ssg08",
  "scout": "ssg08",
  "aug": "aug",
  "sg 553": "sg556",
  "sg553": "sg556",
  "sg556": "sg556",
  "galil ar": "galilar",
  "galil": "galilar",
  "galilar": "galilar",
  "famas": "famas",
  "g3sg1": "g3sg1",
  "scar-20": "scar20",
  "desert eagle": "deagle",
  "deagle": "deagle",
  "usp-s": "usp_silencer",
  "usp": "usp_silencer",
  "usp_silencer": "usp_silencer",
  "hkp2000": "hkp2000",
  "glock-18": "glock",
  "glock": "glock",
  "p2000": "hkp2000",
  "p250": "p250",
  "five-seven": "fiveseven",
  "fiveseven": "fiveseven",
  "tec-9": "tec9",
  "tec9": "tec9",
  "cz75 auto": "cz75a",
  "cz75-auto": "cz75a",
  "r8 revolver": "revolver",
  "revolver": "revolver",
  "dual berettas": "elite",
  "elite": "elite",
  "world": null,
  "mp9": "mp9",
  "mp7": "mp7",
  "mp5-sd": "mp5sd",
  "mp5": "mp5sd",
  "ump-45": "ump45",
  "ump45": "ump45",
  "p90": "p90",
  "pp-bizon": "bizon",
  "bizon": "bizon",
  "mac-10": "mac10",
  "mac10": "mac10",
  "nova": "nova",
  "xm1014": "xm1014",
  "sawed-off": "sawedoff",
  "sawedoff": "sawedoff",
  "mag-7": "mag7",
  "mag7": "mag7",
  "m249": "m249",
  "negev": "negev",
  "zeus x27": "taser",
  "taser": "taser",
  "knife": "knife",
  "c4": "c4",
  "bomb": "c4",
  "smoke grenade": "smokegrenade",
  "smokegrenade": "smokegrenade",
  "flashbang": "flashbang",
  "he grenade": "hegrenade",
  "hegrenade": "hegrenade",
  "high explosive grenade": "hegrenade",
  "molotov": "molotov",
  "incendiary grenade": "incgrenade",
  "incgrenade": "incgrenade",
  "decoy grenade": "decoy",
  "decoy": "decoy",
};

export function iconPathFor(name?: string): string | null {
  if (!name) return null;
  const key = name.toLowerCase().trim().replace(/^weapon_/, "");
  const direct = WEAPON_ICON_MAP[key];
  if (direct === null) return null;
  if (direct) return `/icons/${direct}.svg`;
  if (key.includes("smoke")) return "/icons/smokegrenade.svg";
  if (key.includes("flash")) return "/icons/flashbang.svg";
  if (key.includes("hegrenade") || key.includes("high explosive")) return "/icons/hegrenade.svg";
  if (key.includes("molotov")) return "/icons/molotov.svg";
  if (key.includes("incgrenade") || key.includes("incendiary")) return "/icons/incgrenade.svg";
  if (key.includes("decoy")) return "/icons/decoy.svg";
  if (key.includes("knife") || key.includes("bayonet") || key.includes("karambit")) {
    return "/icons/knife.svg";
  }
  if (/^[a-z0-9_]+$/.test(key)) return `/icons/${key}.svg`;
  return null;
}
