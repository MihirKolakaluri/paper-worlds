import { describe, expect, it } from "vitest";
import { hsvMatch, rgbToHsv, signature } from "@/tracking/signatures";
import { BLUE, GREEN, ORANGE, PALE, WHITE, WOOD, frame, noise, rect } from "./frames";

const box = (cx: number, cy: number, s: number) => ({ x1: cx - s / 2, y1: cy - s / 2, x2: cx + s / 2, y2: cy + s / 2 });

describe("rgbToHsv", () => {
  it("matches known colours", () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(rgbToHsv(0, 255, 0)[0]).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255)[0]).toBeCloseTo(240);
    expect(rgbToHsv(128, 128, 128)[1]).toBe(0);
  });
});

describe("signature", () => {
  it("builds a range around a blue note on white paper, with no warning", () => {
    const f = noise(rect(frame(640, 480, WHITE), 300, 200, 80, 80, BLUE));
    const r = signature(f, box(300, 200, 80));
    if (!r.ok) throw new Error(r.reason);
    const [h, s, v] = rgbToHsv(...BLUE);
    expect(hsvMatch(h, s, v, r.hsv)).toBe(true);
    expect(hsvMatch(...rgbToHsv(...GREEN), r.hsv)).toBe(false);
    expect(hsvMatch(...rgbToHsv(...WHITE), r.hsv)).toBe(false);
    expect(r.hsv.sMin).toBeGreaterThanOrEqual(0.2);
    expect(r.warning).toBeUndefined();
    expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("only reads the middle of the box, so a loose box around white paper still works", () => {
    const f = rect(frame(640, 480, WHITE), 300, 200, 60, 60, GREEN); // the box is a third bigger than the note
    const r = signature(f, box(300, 200, 84));
    expect(r.ok).toBe(true);
  });
  it("wraps hue around 0 for a red note", () => {
    const f = rect(rect(frame(320, 240, WHITE), 100, 100, 30, 60, [220, 30, 50]), 130, 100, 30, 60, [225, 45, 20]);
    const r = signature(f, box(115, 100, 60));
    if (!r.ok) throw new Error(r.reason);
    expect(r.hsv.hMin).toBeGreaterThan(r.hsv.hMax);
    expect(hsvMatch(...rgbToHsv(220, 30, 50), r.hsv)).toBe(true);
    expect(hsvMatch(...rgbToHsv(225, 45, 20), r.hsv)).toBe(true);
    expect(hsvMatch(...rgbToHsv(...BLUE), r.hsv)).toBe(false);
  });
  it("refuses a pale note: the saturation floor", () => {
    const f = rect(frame(320, 240, WOOD), 100, 100, 60, 60, PALE);
    expect(signature(f, box(100, 100, 60))).toMatchObject({ ok: false });
  });
  it("warns when an orange note sits on wood (the spike's failure)", () => {
    const f = noise(rect(frame(640, 480, WOOD), 300, 200, 80, 80, ORANGE));
    const r = signature(f, box(300, 200, 80));
    if (!r.ok) throw new Error(r.reason);
    expect(r.warning).toMatch(/background/i);
  });
  it("does not count another note of the same colour as background", () => {
    const f = rect(rect(frame(640, 480, WHITE), 200, 200, 100, 100, BLUE), 400, 200, 100, 100, BLUE);
    const r = signature(f, box(200, 200, 100), [box(400, 200, 100)]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.warning).toBeUndefined();
  });
});

describe("things that aren't notes", () => {
  it("refuses a hand, which SAM can mistake for a note", () => {
    const hand: [number, number, number] = [107, 74, 58]; // read off the real screen recording
    const f = rect(frame(320, 240, WHITE), 100, 100, 60, 60, hand);
    expect(signature(f, { x1: 70, y1: 70, x2: 130, y2: 130 }).ok).toBe(false);
  });
});
