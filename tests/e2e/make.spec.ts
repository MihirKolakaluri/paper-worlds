import { expect, test } from "@playwright/test";

// The real draw-to-play path: upload a drawing, Spark reads it, the level plays.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

test("upload a drawing and play it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/make`);
  await page.locator('input[type="file"]:not([capture])').setInputFiles("public/samples/a.jpg");
  await page.getByRole("button", { name: "Make my level" }).click();
  await expect(page).toHaveURL(/\/play/, { timeout: 50_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Add sticky notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on mic" })).toBeVisible();
});
