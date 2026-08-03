import { assetPath } from "@/lib/paths";

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
  "knife_bayonet": "bayonet",
  "bayonet": "bayonet",
  "knife_butterfly": "knife_butterfly",
  "knife_canis": "knife_canis",
  "knife_cord": "knife_cord",
  "knife_css": "knife_css",
  "knife_flip": "knife_flip",
  "knife_gut": "knife_gut",
  "knife_gypsy_jackknife": "knife_gypsy_jackknife",
  "knife_karambit": "knife_karambit",
  "karambit": "knife_karambit",
  "knife_kukri": "knife_kukri",
  "knife_m9_bayonet": "knife_m9_bayonet",
  "m9 bayonet": "knife_m9_bayonet",
  "knife_outdoor": "knife_outdoor",
  "knife_push": "knife_push",
  "knife_skeleton": "knife_skeleton",
  "knife_stiletto": "knife_stiletto",
  "knife_survival_bowie": "knife_survival_bowie",
  "knife_t": "knife_t",
  "knife_tactical": "knife_tactical",
  "knife_twinblade": "knife_twinblade",
  "knife_ursus": "knife_ursus",
  "knife_widowmaker": "knife_widowmaker",
  "c4": "c4",
  "bomb": "c4",
  "smoke grenade": "smokegrenade",
  "smokegrenade": "smokegrenade",
  "flashbang": "flashbang",
  "he grenade": "hegrenade",
  "hegrenade": "hegrenade",
  "high explosive grenade": "hegrenade",
  "molotov": "molotov",
  "weapon_molotov": "molotov",
  "incendiary grenade": "incgrenade",
  "incgrenade": "incgrenade",
  "weapon_incgrenade": "incgrenade",
  "incendiarygrenade": "incgrenade",
  "incgrenade_projectile": "incgrenade",
  "cincendiarygrenadeprojectile": "incgrenade",
  "decoy grenade": "decoy",
  "decoy": "decoy",
  "burningflammes": "burning-flames",
  "burningflames": "burning-flames",
};

export function iconPathFor(name?: string): string | null {
  if (!name) return null;
  const key = name.toLowerCase().trim().replace(/^weapon_/, "");
  const direct = WEAPON_ICON_MAP[key];
  if (direct === null) return null;
  if (direct) return assetPath(`/icons/${direct}.svg`);
  if (key.includes("smoke")) return assetPath("/icons/smokegrenade.svg");
  if (key.includes("flash")) return assetPath("/icons/flashbang.svg");
  if (key.includes("hegrenade") || key.includes("high explosive")) return assetPath("/icons/hegrenade.svg");
  if (key.includes("incgrenade") || key.includes("incendiary")) return assetPath("/icons/incgrenade.svg");
  if (key.includes("molotov")) return assetPath("/icons/molotov.svg");
  if (key.includes("decoy")) return assetPath("/icons/decoy.svg");
  if (key.includes("c4") || key.includes("bomb")) return assetPath("/icons/c4.svg");
  if (key.includes("karambit")) return assetPath("/icons/knife_karambit.svg");
  if (key.includes("butterfly")) return assetPath("/icons/knife_butterfly.svg");
  if (key.includes("m9") && key.includes("bayonet")) return assetPath("/icons/knife_m9_bayonet.svg");
  if (key.includes("bayonet")) return assetPath("/icons/bayonet.svg");
  if (key.includes("flip")) return assetPath("/icons/knife_flip.svg");
  if (key.includes("gut")) return assetPath("/icons/knife_gut.svg");
  if (key.includes("bowie")) return assetPath("/icons/knife_bowie.svg");
  if (key.includes("skeleton")) return assetPath("/icons/knife_skeleton.svg");
  if (key.includes("stiletto")) return assetPath("/icons/knife_stiletto.svg");
  if (key.includes("ursus")) return assetPath("/icons/knife_ursus.svg");
  if (key.includes("talon") || key.includes("widowmaker")) return assetPath("/icons/knife_widowmaker.svg");
  if (key.includes("knife")) {
    return assetPath("/icons/knife.svg");
  }
  if (/^[a-z0-9_]+$/.test(key)) return assetPath(`/icons/${key}.svg`);
  return null;
}
