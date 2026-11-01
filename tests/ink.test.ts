import { describe, expect, it } from "vitest";
import { buildLevel, cropToInk, flatten, type Img, type Mark } from "@/level/ink";
import { clampRaise, clampSpeed } from "@/game/rules";

// Synthetic flat page: paper, one long dark ground line, a short platform, a red lava block,
// a stick-figure-like upright blob (spawn) and a flag-like upright blob (goal).
function page(): Img {
  const W = 400, H = 240, d = new Uint8ClampedArray(W * H * 4).fill(235);
  const px = (x: number, y: number, r: number, g: number, b: number) => { const i = 4 * (y * W + x); d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  for (let x = 20; x < 380; x++) for (let y = 200; y < 203; y++) px(x, y, 30, 30, 60);      // ground
  for (let x = 150; x < 260; x++) for (let y = 140; y < 143; y++) px(x, y, 30, 30, 60);     // platform
  for (let x = 120; x < 160; x++) for (let y = 180; y < 200; y++) px(x, y, 220, 30, 30);    // lava
  for (let x = 40; x < 46; x++) for (let y = 160; y < 200; y++) px(x, y, 30, 30, 60);       // spawn blob
  for (let x = 340; x < 346; x++) for (let y = 150; y < 200; y++) px(x, y, 30, 30, 60);     // goal blob
  return { data: d, width: W, height: H };
}
const marks: Mark[] = [
  { kind: "platform", box: [20, 196, 380, 206] },
  { kind: "platform", box: [150, 125, 260, 135] }, // Spark box 15 px too high: pixels must fix it
  { kind: "lava", box: [120, 180, 160, 200] },
  { kind: "spawn", box: [30, 155, 55, 200] },
  { kind: "goal", box: [330, 145, 355, 200] },
];

describe("buildLevel", () => {
  it("puts platforms on the real ink even when Spark's box is off", () => {
    const { level, error } = buildLevel(page(), marks, 400, 240);
    expect(error).toBeUndefined();
    expect(level.solid[140 >> 3].slice(20, 30).every(Boolean)).toBe(true); // platform row 17
    expect(level.solid[125 >> 3].some(Boolean)).toBe(false);               // not where Spark guessed
    expect(level.lava[23][16]).toBe(true);
    expect(level.spawn.x).toBeGreaterThan(4); expect(level.spawn.x).toBeLessThan(7);
    expect(level.goal.x).toBeGreaterThanOrEqual(41); expect(level.goal.x).toBeLessThanOrEqual(43);
  });
  it("explains what's missing", () => {
    expect(buildLevel(page(), marks.filter(m => m.kind !== "goal"), 400, 240).error).toMatch(/flag/);
    expect(buildLevel(page(), marks.filter(m => m.kind !== "spawn"), 400, 240).error).toMatch(/stick figure/);
  });
  it("flatten keeps the paper's shape and cropToInk trims blank paper", () => {
    const img = page();
    const flat = flatten(img, [[0, 0], [400, 0], [400, 240], [0, 240]]);
    expect(flat.width).toBe(1100); expect(Math.abs(flat.height - 660)).toBeLessThanOrEqual(1);
    const c = cropToInk(img);
    expect(c.height).toBeLessThan(240); // blank paper above the top platform is trimmed
  });
});

describe("rule math", () => {
  it("clamps lava rise and speed", () => {
    expect(clampRaise(1)).toBe(8); expect(clampRaise(50)).toBe(48); expect(clampRaise(999)).toBe(64);
    expect(clampSpeed(10)).toBe(2.5); expect(clampSpeed(0)).toBe(0.5);
  });
});
