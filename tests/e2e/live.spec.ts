import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The paths that need the app's own server: a typed rule through Wonder, and the camera panel on a fake camera.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["camera", "microphone"], viewport: { width: 1280, height: 800 } });

test("a typed rule compiles through Wonder and changes the game", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${BASE}/play?demo=a`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Type a rule/).fill("make the lava rise every 2 seconds");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("button", { name: /remove|undo|×/i }).first()).toBeVisible({ timeout: 25_000 });
});

test("camera panel: stopping during Find notes leaves nothing stuck", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE);
  const level = readFileSync("public/samples/a.json", "utf8");
  await page.evaluate(l => sessionStorage.setItem("pw-level", l), level);
  await page.goto(`${BASE}/play`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "Add sticky notes" }).click();
  await page.getByRole("button", { name: "Use the whole picture" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "Find notes" }).click();
  await page.getByRole("button", { name: "Stop camera" }).click();

  await page.waitForTimeout(6000); // let the SAM call land after the stop
  await page.getByRole("button", { name: "Add sticky notes" }).click();
  await page.getByRole("button", { name: "Use the whole picture" }).click({ timeout: 15_000 });
  const find = page.getByRole("button", { name: "Find notes" });
  await expect(find).toBeEnabled();
  await find.click();
  await expect(page.getByRole("alert").or(page.getByText(/Following/)).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Stop camera" }).click();
  expect(errors).toEqual([]);
});
