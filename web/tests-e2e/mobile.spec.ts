import { expect, test } from "@playwright/test";

test("mobile home keeps the principal layout inside the viewport", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "RoundLab" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a local CS2 demo file" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stockage local" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
