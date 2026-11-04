import { expect, test } from "@playwright/test";

// A stranger with no paper, camera or AI: land, try a sample, steer the platform, come back.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.SHOTS;

for (const [name, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
  test(`demo mode on ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.goto(BASE);
    await expect(page.getByRole("heading", { name: "Paper Worlds" })).toBeVisible();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-landing.png`, fullPage: true });

    await page.getByRole("link", { name: "Try it now (no setup)" }).click();
    await expect(page).toHaveURL(/demo=a/);
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);

    await page.getByRole("button", { name: "Add a moving platform" }).click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-play.png` });
    await expect(page.getByRole("button", { name: "Remove the platform" })).toBeVisible();

    await page.getByRole("link", { name: "Lava run" }).click();
    await expect(page).toHaveURL(/demo=b/);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "← Home" }).click();
    await expect(page.getByRole("heading", { name: "Paper Worlds" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
