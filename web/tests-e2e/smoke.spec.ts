import { expect, test, type Page } from "@playwright/test";

const matchId = "multibrowser-fixture";

async function seedMatch(page: Page): Promise<void> {
  await page.evaluate(async (id) => {
    const round = {
      number: 1,
      startTick: 0,
      freezeEndTick: 0,
      endTick: 768,
      duration: 12,
      winner: "T",
      scoreA: 1,
      scoreB: 0,
      frames: [{ t: 0, players: [
        { id: "1", x: -100, y: 200, z: 10, yaw: 90, hp: 100, armor: 100, team: 2, weapons: ["ak47"] },
        { id: "2", x: 300, y: -50, z: 20, yaw: 180, hp: 100, armor: 100, team: 3, weapons: ["m4a1"] },
      ] }],
      events: [{ t: 2, type: "kill", killer: "1", victim: "2", weapon: "ak47", hs: true }],
      damages: [], disconnects: [], flashes: [], purchases: [], effects: [], weaponFires: [], bulletImpacts: [], projectileFrames: [],
    };
    const metadata = {
      schemaVersion: "roundlab.replay.v2",
      meta: { map: "de_nuke", tickRate: 64, sampleRate: 16, durationSec: 12, teamA: "Alpha", teamB: "Bravo", scoreA: 1, scoreB: 0 },
      players: [{ steamId: "1", name: "Alice", team: "T" }, { steamId: "2", name: "Bob", team: "CT" }],
      rounds: [{ ...round, frames: [], events: [], damages: [], disconnects: [], flashes: [], purchases: [], effects: [], weaponFires: [], bulletImpacts: [], projectileFrames: [] }],
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("roundlab-web", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("matches")) db.createObjectStore("matches", { keyPath: "id" });
        if (!db.objectStoreNames.contains("rounds")) {
          const rounds = db.createObjectStore("rounds", { keyPath: "key" });
          rounds.createIndex("matchId", "matchId", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["matches", "rounds", "meta"], "readwrite");
        tx.objectStore("meta").put({ key: "schema", version: 2 });
        tx.objectStore("matches").put({ id, name: "Cross-browser fixture", createdAt: 1, size: 1024, metadata });
        tx.objectStore("rounds").put({ key: `${id}:1`, matchId: id, number: 1, round });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, matchId);
  await page.reload();
}

test("home exposes required browser APIs and durable IndexedDB", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab" })).toBeVisible();
  const support = await page.evaluate(() => ({
    worker: typeof Worker !== "undefined",
    wasm: typeof WebAssembly !== "undefined",
    indexedDb: typeof indexedDB !== "undefined",
    storageManager: Boolean(navigator.storage),
  }));
  expect(support).toEqual({ worker: true, wasm: true, indexedDb: true, storageManager: true });
  await seedMatch(page);
  await expect(page.getByText("Cross-browser fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stockage local" })).toBeVisible();
});

test("exports, deletes, restores and opens replay plus report", async ({ page }) => {
  await page.goto("./");
  await seedMatch(page);

  await page.getByRole("button", { name: "Match actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Exporter" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  if (!backupPath) throw new Error("The browser did not expose the downloaded backup path.");

  await page.getByRole("button", { name: "Match actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete match?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Cross-browser fixture", { exact: true })).toBeHidden();

  await page.getByLabel("Choisir une sauvegarde RoundLab").setInputFiles(backupPath);
  await expect(page.getByText("1 match(s) restauré(s).", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("img", { name: "Interactive replay radar" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const replayScripts = new Set(await page.evaluate(() =>
    performance.getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .map((entry) => entry.name),
  ));
  await page.getByRole("button", { name: "Rapport" }).click();
  await expect(page.getByRole("heading", { name: "Rapport du match" })).toBeVisible();
  await expect(page.getByText("1 round · 2 joueurs analysés", { exact: true })).toBeVisible();
  const reportScripts = new Set(await page.evaluate(() =>
    performance.getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .map((entry) => entry.name),
  ));
  expect(reportScripts.size).toBeGreaterThan(replayScripts.size);
});
