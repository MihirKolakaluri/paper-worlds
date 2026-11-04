import { expect, test } from "@playwright/test";

// A stranger with no paper, camera or AI: land, try a sample, steer the platform, come back.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
test.use({ browserName: (process.env.PW_BROWSER ?? "chromium") as "chromium" | "webkit" });
const SHOTS = process.env.SHOTS;

for (const [name, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
  test(`demo mode on ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.goto(BASE);
    await expect(page.getByRole("heading", { name: "Paper Worlds" })).toBeVisible();
    await expect(page.getByText("Move platforms with sticky notes")).toBeVisible();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-landing.png`, fullPage: true });

    await page.getByRole("link", { name: "Play this drawing" }).click();
    await expect(page).toHaveURL(/demo=b/);
    await expect(page.getByLabel("Type a rule")).toHaveAttribute("placeholder", "Try: double speed");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);

    await page.getByRole("button", { name: "Add a moving platform" }).click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-play.png` });
    await expect(page.getByRole("button", { name: "Remove the platform" })).toBeVisible();

    await page.getByRole("button", { name: /Lava rises every 5 seconds/ }).click();
    await expect(page.getByText("Lava rises every 5 seconds").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /mic/i })).toHaveCount(0);
    await page.waitForTimeout(6000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-rule.png` });

    await page.getByRole("link", { name: "First drawing" }).click();
    await expect(page).toHaveURL(/demo=a/);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "← Home" }).click();
    await expect(page.getByRole("heading", { name: "Paper Worlds" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("rising lava never traps a player in a respawn loop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/play?demo=a`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Lava rises every 5 seconds/ }).click();
  await page.waitForTimeout(30_000); // stand still: lava reaches the player, then keep watching
  const falls = Number((await page.getByText(/^Falls:/).innerText()).replace(/\D/g, ""));
  expect(falls).toBeGreaterThan(0);
  expect(falls).toBeLessThanOrEqual(8); // a respawn loop would be about 40 in this time
});
