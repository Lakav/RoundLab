import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const matchId = "rncp-accessibility-fixture";

async function seedReplay(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async ({ id }) => {
    const metadata = {
      meta: {
        map: "de_nuke",
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
      const request = indexedDB.open("roundlab-web", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("matches")) db.createObjectStore("matches", { keyPath: "id" });
        if (!db.objectStoreNames.contains("rounds")) {
          const store = db.createObjectStore("rounds", { keyPath: "key" });
          store.createIndex("matchId", "matchId", { unique: false });
        }
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
  }, { id: matchId });
  await page.reload();
}

test("home, import and library expose accessible controls", async ({ page }) => {
  await seedReplay(page);
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab" })).toBeVisible();
  const importer = page.getByRole("button", { name: "Open a local CS2 demo file" });
  await expect(importer).toBeVisible();
  await importer.focus();
  await expect(importer).toBeFocused();
  await expect(page.getByText("Accessibility fixture")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
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
