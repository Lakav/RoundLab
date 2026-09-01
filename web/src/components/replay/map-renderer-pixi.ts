import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
} from "pixi.js";

export const MAX_DEFERRED_DESTROY_OBJECTS = 192;
const DISPLAY_OBJECT_DESTROY_OPTIONS = {
  children: true,
  context: true,
  style: true,
} as const;

export type DisposableDisplayObject = Container | Graphics | Sprite | Text;

export type MapRendererPixiLayers = {
  background: Container;
  habits: Container;
  utilities: Container;
  bomb: Container;
  players: Container;
  deaths: Container;
};

export type MapRendererPixiScene = {
  app: Application;
  layers: MapRendererPixiLayers;
};

export function createMapRendererPixiLayers(
  stage: Container,
): MapRendererPixiLayers {
  const layers: MapRendererPixiLayers = {
    background: new Container(),
    habits: new Container(),
    utilities: new Container(),
    bomb: new Container(),
    players: new Container(),
    deaths: new Container(),
  };
  stage.addChild(
    layers.background,
    layers.habits,
    layers.utilities,
    layers.bomb,
    layers.players,
    layers.deaths,
  );
  return layers;
}

export async function initializeMapRendererPixi(
  host: HTMLDivElement,
  size: number,
  condensed: boolean,
  isCancelled: () => boolean,
): Promise<MapRendererPixiScene | null> {
  const app = new Application();
  await app.init({
    width: 1,
    height: 1,
    antialias: true,
    backgroundAlpha: 0,
    resolution: condensed
      ? Math.min(1.5, window.devicePixelRatio || 1)
      : window.devicePixelRatio || 1,
    autoDensity: true,
  });
  if (isCancelled()) {
    app.destroy(true);
    return null;
  }

  const layers = createMapRendererPixiLayers(app.stage);
  app.canvas.style.position = "absolute";
  app.canvas.style.inset = "0";
  app.canvas.style.zIndex = "1";
  host.appendChild(app.canvas);
  app.renderer.resize(size, size);
  return { app, layers };
}

export function resizeMapRendererPixi(
  scene: MapRendererPixiScene,
  size: number,
  condensed: boolean,
): void {
  scene.app.renderer.resolution = condensed
    ? Math.min(1.5, window.devicePixelRatio || 1)
    : window.devicePixelRatio || 1;
  scene.app.renderer.resize(size, size);
}

export function destroyMapRendererPixi(
  scene: MapRendererPixiScene | null,
): void {
  if (!scene) return;
  scene.app.destroy(true, DISPLAY_OBJECT_DESTROY_OPTIONS);
}

export function queueLayerChildrenForDestroy(
  layer: Container,
  queue: DisposableDisplayObject[],
): void {
  const removed = layer.removeChildren() as DisposableDisplayObject[];
  for (const child of removed) {
    if (queue.length < MAX_DEFERRED_DESTROY_OBJECTS) {
      queue.push(child);
    } else if (!child.destroyed) {
      child.destroy(DISPLAY_OBJECT_DESTROY_OPTIONS);
    }
  }
}

export function drainDestroyQueue(
  queue: DisposableDisplayObject[],
  maxItems = 32,
  maxMilliseconds = 2,
): void {
  const started = performance.now();
  for (let index = 0; index < maxItems && queue.length > 0; index++) {
    if (performance.now() - started > maxMilliseconds) break;
    const child = queue.pop();
    if (child && !child.destroyed) {
      child.destroy(DISPLAY_OBJECT_DESTROY_OPTIONS);
    }
  }
}

export function destroyQueuedDisplayObjects(
  queue: DisposableDisplayObject[],
): void {
  while (queue.length > 0) {
    const child = queue.pop();
    if (child && !child.destroyed) {
      child.destroy(DISPLAY_OBJECT_DESTROY_OPTIONS);
    }
  }
}

export function destroyPixiChild(
  parent: Container | null,
  child: Container | null,
): void {
  if (!child || child.destroyed) return;
  parent?.removeChild(child);
  child.destroy(DISPLAY_OBJECT_DESTROY_OPTIONS);
}

export function startAnimationFrameLoop(
  renderFrame: (now: number) => void,
): () => void {
  let animationFrame = 0;
  const loop = (now: number) => {
    animationFrame = requestAnimationFrame(loop);
    renderFrame(now);
  };
  animationFrame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(animationFrame);
}
