import { describe, expect, it } from "vitest";
import { boxToLevel, calibrate, fullFrameCorners, noteShape, toLevel, turnedCorners } from "@/tracking/calibrate";
import type { Pt } from "@/level/ink";

const LW = 640, LH = 320;

describe("calibrate", () => {
  it("maps the 4 corners and the middle of a straight-on paper", () => {
    const c = calibrate([[40, 30], [280, 30], [280, 150], [40, 150]], LW, LH);
    if (!c.ok) throw new Error(c.error);
    const [x, y] = toLevel(c.H, 160, 90);
    expect(x).toBeCloseTo(320, 3);
    expect(y).toBeCloseTo(160, 3);
    expect(toLevel(c.H, 40, 30)[0]).toBeCloseTo(0, 3);
    expect(toLevel(c.H, 280, 150)[1]).toBeCloseTo(320, 3);
  });
  it("undoes perspective: known points on a tilted paper land where they should", () => {
    // Project level points through a known homography, then calibrate from the corners only.
    const G = [0.4, 0.05, 35, -0.03, 0.42, 20, 0.0002, 0.0004, 1];
    const fwd = (x: number, y: number): Pt => { const w = G[6] * x + G[7] * y + G[8]; return [(G[0] * x + G[1] * y + G[2]) / w, (G[3] * x + G[4] * y + G[5]) / w]; };
    const c = calibrate([fwd(0, 0), fwd(LW, 0), fwd(LW, LH), fwd(0, LH)], LW, LH);
    if (!c.ok) throw new Error(c.error);
    for (const [x, y] of [[100, 50], [320, 160], [600, 300], [13, 287]]) {
      const [cx, cy] = fwd(x, y), [u, v] = toLevel(c.H, cx, cy);
      expect(u).toBeCloseTo(x, 2);
      expect(v).toBeCloseTo(y, 2);
    }
  });
  it("works with the camera upside down or mirrored, because click order sets the page's top", () => {
    const flipped = calibrate([[280, 150], [40, 150], [40, 30], [280, 30]], LW, LH);
    if (!flipped.ok) throw new Error(flipped.error);
    expect(toLevel(flipped.H, 280, 150)[0]).toBeCloseTo(0, 3);
    expect(calibrate([[280, 30], [40, 30], [40, 150], [280, 150]], LW, LH).ok).toBe(true);
  });
  it("rejects corners that don't make a paper", () => {
    expect(calibrate([[10, 10], [12, 10], [12, 12], [10, 12]], LW, LH)).toMatchObject({ ok: false }); // tiny
    expect(calibrate([[40, 30], [280, 150], [280, 30], [40, 150]], LW, LH)).toMatchObject({ ok: false }); // crossed
    expect(calibrate([[0, 0], [100, 0], [200, 0], [300, 0]], LW, LH)).toMatchObject({ ok: false }); // a line
  });
  it("the whole picture works as a fallback", () => {
    const c = calibrate(fullFrameCorners(320, 240), LW, LH);
    if (!c.ok) throw new Error(c.error);
    expect(toLevel(c.H, 160, 120)[0]).toBeCloseTo(320, 3);
  });
  it("turns a camera box into a solid tile rectangle of the same size in the level", () => {
    const c = calibrate([[0, 0], [320, 0], [320, 160], [0, 160]], LW, LH); // 2 level px per camera px
    if (!c.ok) throw new Error(c.error);
    const b = boxToLevel(c.H, { x1: 100, y1: 40, x2: 124, y2: 52 });
    expect(b.x).toBeCloseTo(224, 3);
    expect(b.y).toBeCloseTo(92, 3);
    expect(b.w).toBeCloseTo(48, 3);
    expect(b.h).toBeCloseTo(24, 3);
    const shape = noteShape(b, 8);
    expect(shape.length).toBe(2);
    expect(shape[0].length).toBe(6);
    expect(shape.flat().every(Boolean)).toBe(true);
    expect(noteShape({ w: 2, h: 2 }, 8)).toEqual([[true, true]]); // never smaller than the engine's minimum
  });
});

describe("turnedCorners", () => {
  const W = 320, H = 240, LW = 640, LH = 320;
  const map = (turns: number) => { const c = calibrate(turnedCorners(W, H, turns), LW, LH); if (!c.ok) throw new Error(c.error); return (x: number, y: number) => toLevel(c.H, x, y); };
  it("no turns is the plain whole picture", () => {
    expect(turnedCorners(W, H, 0)).toEqual(fullFrameCorners(W, H));
  });
  it("one turn swaps the directions: moving a note down the picture moves the platform across the level", () => {
    const f = map(1), a = f(W, 0), b = f(W, H);
    expect(a[0]).toBeCloseTo(0); expect(a[1]).toBeCloseTo(0);
    expect(b[0]).toBeCloseTo(LW); expect(b[1]).toBeCloseTo(0);
  });
  it("four turns come back to the start", () => {
    expect(turnedCorners(W, H, 4)).toEqual(fullFrameCorners(W, H));
  });
});

describe("noteShape limits", () => {
  it("a note close to the camera still makes a plank, not a slab that covers the lava", () => {
    const shape = noteShape({ w: 400, h: 300 }, 8);
    expect(shape.length).toBe(2);
    expect(shape[0].length).toBe(14);
  });
});
