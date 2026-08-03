import { Assets, Texture } from "pixi.js";
import { iconPathFor } from "@/lib/icons";
import { assetPath } from "@/lib/paths";
import type { Round } from "@/lib/types";

const iconTextureCache = new Map<string, Promise<Texture>>();
const iconTextureReadyCache = new Map<string, Texture>();
const roundIconPreloadCache = new WeakMap<Round, string[]>();

const PRELOADABLE_ICON_PATHS = new Set([
  "/icons/ak47.svg",
  "/icons/armor_helmet.svg",
  "/icons/aug.svg",
  "/icons/awp.svg",
  "/icons/bayonet.svg",
  "/icons/bizon.svg",
  "/icons/burning-flames.svg",
  "/icons/c4.svg",
  "/icons/cz75a.svg",
  "/icons/deagle.svg",
  "/icons/decoy.svg",
  "/icons/defuser.svg",
  "/icons/elite.svg",
  "/icons/famas.svg",
  "/icons/fiveseven.svg",
  "/icons/flashbang.svg",
  "/icons/g3sg1.svg",
  "/icons/galilar.svg",
  "/icons/glock.svg",
  "/icons/hegrenade.svg",
  "/icons/hkp2000.svg",
  "/icons/incgrenade.svg",
  "/icons/kevlar.svg",
  "/icons/knife.svg",
  "/icons/knife_bowie.svg",
  "/icons/knife_butterfly.svg",
  "/icons/knife_canis.svg",
  "/icons/knife_cord.svg",
  "/icons/knife_css.svg",
  "/icons/knife_flip.svg",
  "/icons/knife_gut.svg",
  "/icons/knife_gypsy_jackknife.svg",
  "/icons/knife_karambit.svg",
  "/icons/knife_kukri.svg",
  "/icons/knife_m9_bayonet.svg",
  "/icons/knife_outdoor.svg",
  "/icons/knife_push.svg",
  "/icons/knife_skeleton.svg",
  "/icons/knife_slash.svg",
  "/icons/knife_stiletto.svg",
  "/icons/knife_survival_bowie.svg",
  "/icons/knife_t.svg",
  "/icons/knife_tactical.svg",
  "/icons/knife_twinblade.svg",
  "/icons/knife_ursus.svg",
  "/icons/knife_widowmaker.svg",
  "/icons/m249.svg",
  "/icons/m4a1.svg",
  "/icons/m4a1_silencer.svg",
  "/icons/mac10.svg",
  "/icons/mag7.svg",
  "/icons/molotov.svg",
  "/icons/mp5sd.svg",
  "/icons/mp7.svg",
  "/icons/mp9.svg",
  "/icons/negev.svg",
  "/icons/nova.svg",
  "/icons/p2000.svg",
  "/icons/p250.svg",
  "/icons/p90.svg",
  "/icons/revolver.svg",
  "/icons/sawedoff.svg",
  "/icons/scar20.svg",
  "/icons/sg556.svg",
  "/icons/smokegrenade.svg",
  "/icons/ssg08.svg",
  "/icons/taser.svg",
  "/icons/tec9.svg",
  "/icons/ump45.svg",
  "/icons/usp_silencer.svg",
  "/icons/xm1014.svg",
]);

// Pixi's SVG asset pipeline has been brittle across runtimes. Loading the bytes
// ourselves and feeding a blob URL into a vanilla HTMLImageElement keeps utility
// icons rendering consistently in the browser.
async function loadSvgTextureDirect(path: string): Promise<Texture> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`fetch ${path}: ${response.status}`);
  const blob = new Blob([await response.text()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 64;
    canvas.height = image.naturalHeight || image.height || 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`canvas context unavailable for ${path}`);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadIconTexture(path: string): Promise<Texture> {
  const ready = iconTextureReadyCache.get(path);
  if (ready) return Promise.resolve(ready);
  let pending = iconTextureCache.get(path);
  if (!pending) {
    const resolvedPath = assetPath(path);
    const loader = path.toLowerCase().endsWith(".svg")
      ? loadSvgTextureDirect(resolvedPath)
      : (Assets.load(resolvedPath) as Promise<Texture>);
    pending = loader
      .then((texture) => {
        iconTextureReadyCache.set(path, texture);
        return texture;
      })
      .catch((error) => {
        iconTextureCache.delete(path);
        iconTextureReadyCache.delete(path);
        console.error(`[icons] failed to load ${path}`, error);
        throw error;
      });
    iconTextureCache.set(path, pending);
  }
  return pending;
}

export function cachedIconTexture(path: string): Texture | undefined {
  return iconTextureReadyCache.get(path);
}

function addPreloadPath(paths: Set<string>, path: string | null): void {
  if (path && PRELOADABLE_ICON_PATHS.has(path)) paths.add(path);
}

function preloadIconPathSet(paths: Set<string>): void {
  for (const path of paths) {
    if (!cachedIconTexture(path)) void loadIconTexture(path).catch(() => {});
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function collectRoundIconPreloadPaths(
  round: Round,
  shouldCancel: () => boolean,
): Promise<string[]> {
  const cached = roundIconPreloadCache.get(round);
  if (cached) return cached;
  const paths = new Set<string>([
    "/icons/c4.svg",
    "/icons/smokegrenade.svg",
    "/icons/flashbang.svg",
    "/icons/hegrenade.svg",
    "/icons/molotov.svg",
    "/icons/incgrenade.svg",
    "/icons/decoy.svg",
  ]);

  for (let index = 0; index < round.frames.length; index++) {
    if (shouldCancel()) return [];
    const frame = round.frames[index];
    for (const player of frame.players) {
      addPreloadPath(paths, iconPathFor(player.active));
      for (const weapon of player.weapons ?? []) addPreloadPath(paths, iconPathFor(weapon));
      if (player.activeAction) {
        addPreloadPath(
          paths,
          iconPathFor(player.activeAction.type === "plant" ? "c4" : player.activeAction.item),
        );
      }
    }
    for (const projectile of frame.projectiles ?? []) {
      addPreloadPath(paths, iconPathFor(projectile.type));
    }
    if (index % 160 === 159) await yieldToMainThread();
  }

  for (let index = 0; index < (round.projectileFrames ?? []).length; index++) {
    if (shouldCancel()) return [];
    const frame = round.projectileFrames![index];
    for (const projectile of frame.projectiles) {
      addPreloadPath(paths, iconPathFor(projectile.type));
    }
    if (index % 240 === 239) await yieldToMainThread();
  }

  for (const fire of round.weaponFires ?? []) addPreloadPath(paths, iconPathFor(fire.weapon));
  for (const effect of round.effects ?? []) {
    if (effect.type === "fire") {
      addPreloadPath(paths, iconPathFor(effect.variant === "incendiary" ? "incgrenade" : "molotov"));
    } else {
      addPreloadPath(paths, iconPathFor(effect.type));
    }
  }

  const result = [...paths];
  roundIconPreloadCache.set(round, result);
  return result;
}

export async function preloadRoundIconTextures(
  rounds: Round[],
  shouldCancel: () => boolean,
): Promise<void> {
  const paths = new Set<string>();
  for (const round of rounds) {
    if (shouldCancel()) return;
    for (const path of await collectRoundIconPreloadPaths(round, shouldCancel)) paths.add(path);
    preloadIconPathSet(paths);
  }
}
