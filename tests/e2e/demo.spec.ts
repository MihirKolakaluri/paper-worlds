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
    await expect(page.getByRole("heading", { name: "If you can draw it, you can play it." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Four Meta models. One piece of paper." })).toBeVisible();
    for (const m of ["Muse Spark", "SAM 3.1", "Muse Wonder", "Muse Voice Transcribe"]) await expect(page.getByRole("heading", { name: m })).toBeVisible();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-landing.png`, fullPage: true });

    await page.getByRole("link", { name: "Play a sample" }).click();
    await expect(page).toHaveURL(/demo=a/);
    await expect(page.getByLabel("Type a rule")).toHaveAttribute("placeholder", "Try: double speed");
    await expect(page.getByText("Drawn by hand. Now beat it.")).toBeVisible();
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);

    await page.getByRole("button", { name: /Lava rises every 5 seconds/ }).click();
    await expect(page.getByText("Lava rises every 5 seconds").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /mic/i })).toHaveCount(0);
    await page.waitForTimeout(6000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-rule.png` });

    await page.getByRole("link", { name: "Lava run" }).click();
    await expect(page).toHaveURL(/demo=b/);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "← Home" }).click();
    await expect(page.getByRole("heading", { name: "If you can draw it, you can play it." })).toBeVisible();
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

test("flipped gravity can't trap a player in a falling loop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/play?demo=a`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Flip gravity every 6 seconds/ }).click();
  await page.waitForTimeout(11_000);
  const falls = Number((await page.getByText(/^Falls:/).innerText()).replace(/\D/g, ""));
  console.log("FLIPFALLS", falls);
  expect(falls).toBeLessThanOrEqual(2);
});

test("Asteroid Surf opens clean from the landing page and steers with no setup", async ({ page }) => {
  test.setTimeout(40_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE);
  await page.getByRole("link", { name: "Start surfing" }).click();
  await expect(page).toHaveURL(/surf/);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Surf to the end. Dodge the asteroids.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add sticky notes" })).toBeVisible();
  await page.waitForTimeout(4000);
  const now = Number(await page.getByRole("progressbar").getAttribute("aria-valuenow"));
  expect(now).toBeGreaterThan(0);
});
