import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const matchId = "accessibility-fixture";

async function seedReplay(page: Page, map = "de_nuke"): Promise<void> {
  await page.goto("./");
  await page.evaluate(async ({ id, mapName }) => {
    const metadata = {
      meta: {
        map: mapName,
        tickRate: 64,
        sampleRate: 16,
        durationSec: 12,
        teamA: "Alpha",
        teamB: "Bravo",
        scoreA: 1,
        scoreB: 0,
      },
      players: [
        { steamId: 1, name: "Alice", team: "T" },
        { steamId: 2, name: "Bob", team: "CT" },
      ],
      rounds: [{ number: 1, startTick: 0, endTick: 768, duration: 12, winner: "T", frames: [], events: [], effects: [], weaponFires: [], projectileFrames: [] }],
    };
    const round = {
      number: 1,
      startTick: 0,
      endTick: 768,
      duration: 12,
      winner: "T",
      frames: [
        {
          t: 0,
          players: [
            { id: 1, x: -100, y: 200, z: 10, yaw: 90, hp: 100, armor: 100, team: 2, weapons: ["ak47"] },
            { id: 2, x: 300, y: -50, z: 20, yaw: 180, hp: 100, armor: 100, team: 3, weapons: ["m4a1"] },
          ],
        },
      ],
      events: [{ t: 2, type: "kill", killer: 1, victim: 2, weapon: "ak47", hs: true }],
      effects: [],
      weaponFires: [],
      projectileFrames: [],
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("roundlab-web", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("matches")) db.createObjectStore("matches", { keyPath: "id" });
        if (!db.objectStoreNames.contains("rounds")) {
          const store = db.createObjectStore("rounds", { keyPath: "key" });
          store.createIndex("matchId", "matchId", { unique: false });
        }
        const metadataStore = db.objectStoreNames.contains("meta")
          ? request.transaction!.objectStore("meta")
          : db.createObjectStore("meta", { keyPath: "key" });
        metadataStore.put({ key: "schema", version: 2 });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["matches", "rounds"], "readwrite");
        transaction.objectStore("matches").put({ id, name: "Accessibility fixture", createdAt: Date.now(), size: 1024, metadata });
        transaction.objectStore("rounds").put({ key: `${id}:1`, matchId: id, number: 1, round });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { id: matchId, mapName: map });
  await page.reload();
}

test("home, import and library expose accessible controls", async ({ page }) => {
  await seedReplay(page);
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const importer = page.getByRole("button", { name: "Open a local CS2 demo file" });
  await expect(importer).toBeVisible();
  await importer.focus();
  await expect(importer).toBeFocused();
  await expect(page.getByText("Accessibility fixture")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("import errors and library dialogs announce state and manage focus", async ({ page }) => {
  await seedReplay(page);

  await page.getByTestId("demo-file-input").setInputFiles({
    name: "not-a-demo.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByText("Choose a .dem or .dem.zst file.", { exact: true })).toHaveAttribute("role", "alert");

  await page.getByRole("button", { name: "Match actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename match" });
  await expect(renameDialog).toBeVisible();
  await expect(renameDialog.getByRole("textbox")).toBeFocused();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(renameDialog).toBeHidden();

  await page.getByRole("button", { name: "Match actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete match?" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteDialog).toBeHidden();
});

test("replay canvas has a keyboard-readable text alternative", async ({ page }) => {
  const renderingErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && (text.includes("[icons] failed") || text.includes("unhandledRejection"))) {
      renderingErrors.push(text);
    }
  });
  await seedReplay(page);
  await page.goto(`./match/?id=${matchId}`);
  const radar = page.getByRole("img", { name: "Interactive replay radar" });
  await expect(radar).toBeVisible();
  await expect(page.getByRole("region", { name: "Text alternative for the replay radar" })).toContainText("Alice");
  await expect(page.getByTitle("Play/Pause (Space)")).toBeEnabled();

  const results = await new AxeBuilder({ page })
    .exclude("canvas")
    .analyze();
  expect(results.violations).toEqual([]);
  expect(renderingErrors).toEqual([]);
});

test("all replay command groups expose names, states and keyboard operation", async ({ page }) => {
  await seedReplay(page);
  await page.goto(`./match/?id=${matchId}`);
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab match replay" })).toBeAttached();

  const play = page.getByTitle("Play/Pause (Space)");
  const timeline = page.getByRole("slider", { name: "Replay time" });
  await expect(play).toBeEnabled();
  await expect(timeline).toBeEnabled();
  await play.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => Number(await timeline.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await page.keyboard.press("Space");

  const doubleSpeed = page.getByRole("button", { name: "Playback speed 2 times" });
  await doubleSpeed.focus();
  await page.keyboard.press("Enter");
  await expect(doubleSpeed).toHaveAttribute("aria-pressed", "true");

  const lowerLayer = page.getByTitle("Radar layer: Lower");
  await lowerLayer.focus();
  await page.keyboard.press("Enter");
  await expect(lowerLayer).toHaveAttribute("aria-pressed", "true");

  const zoomIn = page.getByTitle("Zoom in");
  await zoomIn.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("125%", { exact: true })).toBeVisible();

  const pen = page.getByTitle("Pen (Alt+P)");
  await page.keyboard.press("Alt+p");
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  const drawingCanvas = page.locator("canvas").last();
  const drawingBox = await drawingCanvas.boundingBox();
  if (!drawingBox) throw new Error("Drawing canvas has no pointer bounds");
  await page.mouse.move(drawingBox.x + drawingBox.width * 0.35, drawingBox.y + drawingBox.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(drawingBox.x + drawingBox.width * 0.55, drawingBox.y + drawingBox.height * 0.55, { steps: 4 });
  await page.mouse.up();
  const undo = page.getByTitle("Undo (Cmd+Z)");
  await expect(undo).toBeEnabled();
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(undo).toBeDisabled();

  const select = page.getByTitle("Select (Alt+V)");
  await page.keyboard.press("Alt+v");
  await expect(select).toHaveAttribute("aria-pressed", "true");
  const viewport = page.getByTestId("match-map-viewport");
  const content = page.getByTestId("match-map-content");
  const transformBeforePan = await content.evaluate((element) => (element as HTMLElement).style.transform);
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error("Replay viewport has no pointer bounds");
  await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewportBox.x + viewportBox.width / 2 + 30, viewportBox.y + viewportBox.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(() => content.evaluate((element) => (element as HTMLElement).style.transform)).not.toBe(transformBeforePan);

  const condensed = page.getByRole("button", { name: "Trajectoires" });
  await condensed.focus();
  await page.keyboard.press("Enter");
  await expect(condensed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Compared player" })).toBeVisible();

  expect((await new AxeBuilder({ page }).exclude("canvas").analyze()).violations).toEqual([]);
});

test("replay retains essential controls in narrow reflow viewports", async ({ page }) => {
  await seedReplay(page);
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto(`./match/?id=${matchId}`);
  await expect(page.getByTitle("Play/Pause (Space)")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Replay time" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Interactive replay radar" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByTitle("Play/Pause (Space)")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Replay time" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Text alternative for the replay radar" })).toBeAttached();
});

test("Anubis radar stays inside the safe viewport above replay controls", async ({ page }) => {
  await seedReplay(page, "de_anubis");
  for (const viewportSize of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewportSize);
    await page.goto(`./match/?id=${matchId}`);
    const radar = page.getByTestId("match-map-viewport");
    const controls = page.getByTestId("match-controls-panel");
    await expect(radar).toBeVisible();
    await expect(controls).toBeVisible();
    const radarBox = await radar.boundingBox();
    const controlsBox = await controls.boundingBox();
    if (!radarBox || !controlsBox) throw new Error("Replay layout has no measurable bounds");
    expect(radarBox.y + radarBox.height).toBeLessThanOrEqual(controlsBox.y);
    await expect(page.getByTestId("match-map-clip")).toHaveCSS("overflow", "hidden");
  }
});

test("essential content survives disabled styles and custom text spacing", async ({ page }) => {
  await page.goto("./");
  await page.locator('link[rel="stylesheet"], style').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a local CS2 demo file" })).toContainText("Open a CS2 demo");

  await page.reload();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({
    content: `
      * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `,
  });
  await expect(page.getByRole("button", { name: "Open a local CS2 demo file" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
