import { describe, expect, it } from "vitest";
import { OneEuro, Tracker } from "@/tracking/tracker";
import { signature } from "@/tracking/signatures";
import { BLUE, GREEN, SKIN, WHITE, frame, noise, rect } from "./frames";

const W = 320, H = 240, S = 40;
const scene = (x: number, y: number, seed = 1) => noise(rect(frame(W, H, WHITE), x, y, S, S, GREEN), 8, seed);
const box = (x: number, y: number) => ({ x1: x - S / 2, y1: y - S / 2, x2: x + S / 2, y2: y + S / 2 });
function start(x = 100, y = 120) {
  const sig = signature(scene(x, y), box(x, y));
  if (!sig.ok) throw new Error(sig.reason);
  const t = new Tracker();
  t.add("a", sig.hsv, x, y, S * S);
  return t;
}

describe("OneEuro", () => {
  it("calms jitter on a still point", () => {
    const f = new OneEuro();
    let raw = 0, out = 0, last = 100;
    for (let i = 0; i < 120; i++) {
      const x = 100 + (i % 2 ? 2 : -2), y = f.next(x, i / 30);
      if (i > 30) { raw += 4; out += Math.abs(y - last); }
      last = y;
    }
    expect(out).toBeLessThan(raw / 2);
  });
  it("barely lags a fast move", () => {
    const f = new OneEuro();
    let y = 0;
    for (let i = 0; i < 30; i++) y = f.next(i * 10, i / 30); // 300 px/s
    expect(290 - y).toBeLessThan(15);
  });
});

describe("Tracker", () => {
  it("follows a moving note through noise, in under 10 ms a frame", () => {
    const t = start(150, 160);
    let worst = 0, total = 0;
    for (let i = 0; i < 90; i++) {
      const x = 150 + 100 * Math.sin(i / 20), y = 120 + 40 * Math.cos(i / 25), f = scene(x, y, i + 2);
      const t0 = performance.now();
      const [o] = t.process(f.data, W, H, i * 33);
      total += performance.now() - t0;
      expect(o.state).toBe("tracking");
      if (i > 5) worst = Math.max(worst, Math.hypot(o.x - x, o.y - y));
    }
    expect(worst).toBeLessThan(6);
    expect(total / 90).toBeLessThan(10);
  });
  it("holds 500 ms, fades, then is gone, and comes back when the hand moves", () => {
    const t = start();
    t.process(scene(100, 120).data, W, H, 0);
    const covered = rect(scene(100, 120), 100, 120, 60, 60, SKIN).data;
    const at = (ms: number) => t.process(covered, W, H, ms)[0];
    expect(at(33)).toMatchObject({ state: "held", alpha: 1 });
    const held = at(450);
    expect(held).toMatchObject({ state: "held", alpha: 1, lostMs: 450 });
    expect(Math.abs(held.x - 100)).toBeLessThan(2);
    const fading = at(800);
    expect(fading.state).toBe("fading");
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.alpha).toBeLessThan(1);
    expect(at(1200)).toMatchObject({ state: "gone", alpha: 0 });
    const back = t.process(scene(180, 120).data, W, H, 1500)[0];
    expect(back).toMatchObject({ state: "tracking", alpha: 1, lostMs: 0 });
    expect(Math.abs(back.x - 180)).toBeLessThan(3); // snaps, no smoothing across the gap
  });
  it("ignores specks of the same colour", () => {
    const t = start();
    const f = rect(rect(frame(W, H, WHITE), 100, 120, S, S, GREEN), 250, 40, 4, 4, GREEN);
    const [o] = t.process(f.data, W, H, 0);
    expect(Math.abs(o.x - 100)).toBeLessThan(3);
    const onlySpeck = rect(frame(W, H, WHITE), 250, 40, 4, 4, GREEN);
    expect(t.process(onlySpeck.data, W, H, 33)[0].state).toBe("held");
  });
  it("two notes of the same colour keep their own blob", () => {
    const sig = signature(scene(100, 120), box(100, 120));
    if (!sig.ok) throw new Error(sig.reason);
    const t = new Tracker();
    t.add("a", sig.hsv, 80, 120, S * S);
    t.add("b", sig.hsv, 240, 120, S * S);
    for (let i = 0; i < 10; i++) {
      const f = rect(rect(frame(W, H, WHITE), 80 + i * 3, 120, S, S, GREEN), 240 - i * 3, 120, S, S, GREEN);
      const [a, b] = t.process(f.data, W, H, i * 33);
      expect(a.x).toBeLessThan(160);
      expect(b.x).toBeGreaterThan(160);
    }
  });
  it("tracks two colours at once", () => {
    const f = rect(rect(frame(W, H, WHITE), 80, 120, S, S, GREEN), 240, 120, S, S, BLUE);
    const g = signature(f, box(80, 120)), b = signature(f, box(240, 120));
    if (!g.ok || !b.ok) throw new Error("no signature");
    const t = new Tracker();
    t.add("g", g.hsv, 80, 120, S * S);
    t.add("b", b.hsv, 240, 120, S * S);
    const [og, ob] = t.process(f.data, W, H, 0);
    expect(Math.abs(og.x - 80)).toBeLessThan(3);
    expect(Math.abs(ob.x - 240)).toBeLessThan(3);
  });
  it("reanchor moves a lost note back to tracking", () => {
    const t = start();
    const empty = frame(W, H, WHITE).data;
    t.process(empty, W, H, 0);
    t.process(empty, W, H, 1200);
    t.reanchor("a", 200, 60, 1300);
    expect(t.get("a")).toMatchObject({ state: "tracking", x: 200, y: 60, alpha: 1 });
  });
});
