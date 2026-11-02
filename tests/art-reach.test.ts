import { describe, expect, test } from "vitest";
import { keepStrokes, inkAlpha } from "@/game/art";
import { checkReach } from "@/game/reach";
import { tuneJump, widenLedge } from "@/level/ink";
import type { Level } from "@/schema/level";

const blank = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill(false) as boolean[]);
function level(over: Partial<Level> = {}): Level {
  const W = 60, H = 40, solid = blank(W, H), lava = blank(W, H);
  for (let c = 0; c < W; c++) solid[35][c] = true; // floor
  return { width: W, height: H, tileSize: 8, spawn: { x: 3, y: 28, w: 2, h: 6 }, goal: { x: 50, y: 30, w: 2, h: 4 }, solid, lava, warnings: [], ...over };
}

describe("keepStrokes", () => {
  const w = 40, h = 20;
  const mask = () => new Uint8Array(w * h);
  test("keeps a whole stroke when any part belongs, drops strays and edge junk", () => {
    const m = mask();
    for (let x = 10; x < 30; x++) m[10 * w + x] = 1; // a line, only its left end "belongs"
    for (let y = 0; y < 5; y++) m[y * w + 38] = 1; // touches the border (a pen)
    m[15 * w + 20] = 1; // a speck
    const out = keepStrokes(m, w, h, (x) => x < 12);
    expect(out[10 * w + 29]).toBe(1);
    expect(out[2 * w + 38]).toBe(0);
    expect(out[15 * w + 20]).toBe(0);
  });
  test("keeps a small flag that touches the top edge", () => {
    const m = mask();
    for (let y = 0; y < 8; y++) for (let x = 20; x < 24; x++) m[y * w + x] = 1;
    expect(keepStrokes(m, w, h, () => true, () => true)[3 * w + 21]).toBe(1);
    expect(keepStrokes(m, w, h, () => true)[3 * w + 21]).toBe(0);
  });
  test("inkAlpha thickens and softens", () => {
    const m = mask(); m[10 * w + 10] = 1;
    const a = inkAlpha(m, w, h, 1);
    expect(a[10 * w + 10]).toBe(255);
    expect(a[10 * w + 12]).toBeGreaterThan(0);
    expect(a[10 * w + 12]).toBeLessThan(255);
  });
});

describe("reach", () => {
  test("flat floor to the flag is reachable", () => {
    expect(checkReach(level())).toEqual({ landed: true, reachable: true });
  });
  test("a wall of lava with no way over is not", () => {
    const lv = level();
    for (let c = 15; c < 45; c++) { lv.solid[35][c] = false; lv.lava[35][c] = true; }
    expect(checkReach(lv).reachable).toBe(false);
  });
  test("nothing under the figure means it never lands", () => {
    const lv = level();
    for (let c = 0; c < 10; c++) { lv.solid[35][c] = false; }
    expect(checkReach(lv).landed).toBe(false);
  });
  test("tuneJump raises the jump just enough for a high platform", () => {
    const lv = level();
    for (let c = 10; c < 60; c++) lv.solid[35][c] = false; // only a start ledge
    for (let c = 14; c < 60; c++) lv.solid[18][c] = true; // goal platform 17 tiles up (136 px, 2.8 figure heights)
    lv.goal = { x: 50, y: 13, w: 2, h: 4 };
    expect(checkReach(lv).reachable).toBe(false);
    expect(tuneJump(lv).reachable).toBe(true);
    expect(lv.jumpH).toBeGreaterThan(136);
    expect(lv.jumpH).toBeLessThan(200);
  });
});

test("widenLedge makes the start ledge at least 5 tiles", () => {
  const solid = blank(20, 20), lava = blank(20, 20);
  solid[12][10] = true;
  widenLedge(solid, lava, { x: 10.5, y: 4, h: 7 });
  expect(solid[12].slice(8, 13)).toEqual([true, true, true, true, true]);
});
