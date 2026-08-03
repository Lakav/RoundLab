import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixture = path.resolve("tests-e2e/fixtures/roundlab-licensed-2v2.dem.zst");
const fixtureSha256 = "5f2cde70d7d73894364817af3b6446d872a5410bea76765fed704d81e00a2135";

test.beforeAll(async () => {
  const contents = await readFile(fixture);
  expect(createHash("sha256").update(contents).digest("hex")).toBe(fixtureSha256);
});

test("imports the licensed zstd demo through WASM and keeps the report after reload", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const phases: string[] = [];
    Object.defineProperty(window, "__roundlabImportPhases", { configurable: true, value: phases });
    window.Worker = class ObservedWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as { type?: string; payload?: { phase?: string } };
          if (data.type === "progress" && data.payload?.phase) phases.push(data.payload.phase);
        });
      }
    };
  });

  await page.goto("./");
  await page.getByTestId("demo-file-input").setInputFiles(fixture);
  const settings = page.getByRole("dialog", { name: "Import settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("dialog", { name: "Parsing demo" })).toBeVisible();

  const parsed = page.getByRole("dialog", { name: "Match parsed" });
  await expect(parsed).toBeVisible({ timeout: 4 * 60_000 });
  const phases = await page.evaluate(() => (
    (window as Window & { __roundlabImportPhases?: string[] }).__roundlabImportPhases ?? []
  ));
  expect(phases).toEqual(expect.arrayContaining(["decompressing", "starting", "parsing", "storing", "done"]));

  await parsed.getByRole("textbox").fill("Fixture 2v2 sous licence");
  await parsed.getByRole("button", { name: "Save & stay" }).click();
  await expect(page.getByText("Fixture 2v2 sous licence", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Fixture 2v2 sous licence", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("img", { name: "Interactive replay radar" })).toBeVisible({ timeout: 2 * 60_000 });

  await page.getByRole("button", { name: "Rapport" }).click();
  const report = page.getByRole("region", { name: "Rapport de partie" });
  await expect(report.getByRole("heading", { name: "Rapport du match" })).toBeVisible({ timeout: 2 * 60_000 });
  await expect(report.getByText("16 rounds · 4 joueurs analysés", { exact: true })).toBeVisible();
  const hero = report.locator("header");
  await expect(hero.getByText("9", { exact: true })).toBeVisible();
  await expect(hero.getByText("7", { exact: true })).toBeVisible();
});
