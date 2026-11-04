import { expect, test, type Page } from "@playwright/test";

// Real play on the dev server, read through the dev-only window.__pw game state.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.SHOTS;
type S = { x: number; y: number; onFloor: boolean; deaths: number; won: boolean; gravityFlipped: boolean };
const state = (p: Page) => p.evaluate(() => (window as unknown as { __pw: S }).__pw);

async function open(page: Page, url: string) {
  await page.goto(`${BASE}${url}`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press("ArrowLeft"); // skips the opening wipe
  await page.waitForFunction(() => !!(window as unknown as { __pw?: unknown }).__pw);
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // Each leg: while standing above minFeet, walk to `walk`, jump, and steer in the air to `air`.
  type Leg = { minFeet: number; walk: number; air: number };
  const ROUTES: Record<string, Leg[]> = {
    a: [{ minFeet: 600, walk: 215, air: 320 }, { minFeet: 470, walk: 432, air: 640 }, { minFeet: 360, walk: 850, air: 1090 }, { minFeet: 0, walk: 1190, air: 1190 }],
    b: [{ minFeet: 640, walk: 290, air: 410 }, { minFeet: 530, walk: 480, air: 800 }, { minFeet: 390, walk: 770, air: 470 }, { minFeet: 290, walk: 500, air: 700 }, { minFeet: 0, walk: 795, air: 795 }],
  };
  for (const id of ["a", "b"]) test(`a bot plays sample ${id} to the flag and sees the win dialog`, async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, `/play?demo=${id}`);
    const route = ROUTES[id], keys = new Set<string>();
    const hold = async (k: string, on: boolean) => { if (on === keys.has(k)) return; if (on) { keys.add(k); await page.keyboard.down(k); } else { keys.delete(k); await page.keyboard.up(k); } };
    const end = Date.now() + 120_000;
    let s = await state(page), leg = route[0], tries = 0;
    while (!s.won && Date.now() < end) {
      const feet = s.y + 22;
      if (s.onFloor) leg = route.find(l => feet >= l.minFeet) ?? route.at(-1)!;
      const dx = leg.walk - s.x;
      await hold("ArrowRight", dx > 6); await hold("ArrowLeft", dx < -6);
      if (s.onFloor && Math.abs(dx) <= 10) {
        tries++;
        const jumped = leg;
        await hold("Space", true);
        const stop = Date.now() + 2500;
        let left = false; // steer until we land again
        while (Date.now() < stop) {
          s = await state(page);
          if (s.won) break;
          if (!s.onFloor) left = true;
          else if (left) break;
          const ax = jumped.air - s.x;
          await hold("ArrowRight", ax > 6); await hold("ArrowLeft", ax < -6);
          if (left && (s as S & { vy: number }).vy >= 0) await hold("Space", false);
          await page.waitForTimeout(20);
        }
        await hold("Space", false);
        if (process.env.TRACE) console.log("JUMP", id, "from", jumped.walk, "air", jumped.air, "landed", Math.round(s.x), Math.round(s.y + 22), "floor", s.onFloor, "deaths", s.deaths);
      }
      await page.waitForTimeout(25);
      s = await state(page);
    }
    for (const k of [...keys]) await page.keyboard.up(k);
    console.log("BOT", id, JSON.stringify({ won: s.won, deaths: s.deaths, tries, x: Math.round(s.x), y: Math.round(s.y) }));
    expect(s.won).toBe(true);
    await expect(page.getByRole("dialog", { name: "You win" })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/win-${id}.png` });
  });

  test("the platform carries the player, and Space never toggles it off", async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, "/play?demo=a");
    await page.getByRole("button", { name: "Add a moving platform" }).click();
    await page.keyboard.press("Space");
    await page.waitForTimeout(1300);
    await expect(page.getByRole("button", { name: "Remove the platform" })).toBeVisible();
    const box = (await page.locator("canvas").boundingBox())!, lvl = await (await page.request.get(`${BASE}/samples/a.json`)).json();
    const k = box.width / (lvl.width * 8);
    const sx = (x: number) => box.x + x * k, sy = (y: number) => box.y + y * k;
    const px = 500, py = 594; // open air past the drawn platform, top about 46 px above the ground
    await page.mouse.move(sx(px), sy(py));
    await page.waitForTimeout(700);
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction(() => (window as unknown as { __pw: S }).__pw.x >= 400, null, { timeout: 8000 });
    await page.keyboard.down("Space");
    await page.waitForFunction(x => (window as unknown as { __pw: S }).__pw.x >= x, px - 10, { timeout: 5000 });
    await page.keyboard.up("ArrowRight"); await page.keyboard.up("Space");
    await page.waitForTimeout(1500);
    const on = await state(page);
    console.log("ON", JSON.stringify({ x: Math.round(on.x), y: Math.round(on.y), deaths: (on as S).deaths }));
    expect(Math.abs(on.y - (py - 8 - 22))).toBeLessThan(12); // standing on the platform, not the ground
    for (let i = 1; i <= 40; i++) { await page.mouse.move(sx(px - i * 5), sy(py)); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);
    const s1 = await state(page);
    console.log("RIDE", JSON.stringify({ on: Math.round(on.x), to: Math.round(s1.x), y: Math.round(s1.y) }));
    expect(on.x - s1.x).toBeGreaterThan(120);
  });

  test("undoing a flip preset really puts gravity back", async ({ page }) => {
    test.setTimeout(40_000);
    await open(page, "/play?demo=a");
    await page.getByRole("button", { name: /Flip gravity every 6 seconds/ }).click();
    await page.waitForFunction(() => (window as unknown as { __pw: S }).__pw.gravityFlipped, null, { timeout: 12_000 });
    await page.getByRole("button", { name: /remove|undo|×/i }).first().click();
    await page.waitForTimeout(400);
    expect((await state(page)).gravityFlipped).toBe(false);
  });

  test("a live 'restart once' rule restarts one time and then leaves you alone", async ({ page }) => {
    test.setTimeout(70_000);
    await open(page, "/play?demo=a");
    const start = (await state(page)).x;
    await page.getByPlaceholder(/Type a rule/).fill("restart the level once after 8 seconds");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByRole("button", { name: /remove|undo|×/i }).first()).toBeVisible({ timeout: 25_000 });
    await page.locator("canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.down("ArrowRight"); await page.waitForTimeout(700); await page.keyboard.up("ArrowRight");
    const moved = (await state(page)).x;
    expect(moved).toBeGreaterThan(start + 20);
    await page.waitForFunction(x => (window as unknown as { __pw: S }).__pw.x < x, start + 10, { timeout: 15_000 });
    await page.keyboard.down("ArrowRight"); await page.waitForTimeout(700); await page.keyboard.up("ArrowRight");
    const again = (await state(page)).x;
    await page.waitForTimeout(12_000);
    expect((await state(page)).x).toBeGreaterThan(start + 20); // a loop would have sent the player home again
    console.log("RESET", JSON.stringify({ start, moved, again }));
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a finger steers the platform and doesn't scroll the page", async ({ page }) => {
    test.setTimeout(40_000);
    await open(page, "/play?demo=a");
    await page.getByRole("button", { name: "Add a moving platform" }).tap();
    await page.waitForTimeout(400);
    const box = (await page.locator("canvas").boundingBox())!;
    const before = await page.locator("canvas").screenshot();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x: number, y: number) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const y = box.y + box.height * 0.3;
    await touch("touchStart", box.x + 40, y);
    for (let i = 0; i < 20; i++) { await touch("touchMove", box.x + 40 + i * 12, y + i * 3); await page.waitForTimeout(25); }
    await page.waitForTimeout(300);
    const scroll = await page.evaluate(() => window.scrollY);
    const after = await page.locator("canvas").screenshot();
    await touch("touchEnd", 0, 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/touch.png` });
    expect(scroll).toBe(0);
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
