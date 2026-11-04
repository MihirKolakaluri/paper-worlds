import { describe, expect, it, vi } from "vitest";
import { BASE_GAP_MS, ReanchorLoop, reconcile, type Anchor, type Capture, type FindResult } from "@/tracking/reanchor";
import { signature } from "@/tracking/signatures";
import { BLUE, GREEN, WHITE, frame, rect } from "./frames";

const S = 40, box = (x: number, y: number) => ({ x1: x - S / 2, y1: y - S / 2, x2: x + S / 2, y2: y + S / 2 });
const f = rect(rect(frame(320, 240, WHITE), 80, 120, S, S, GREEN), 240, 120, S, S, BLUE);
const sig = (x: number) => { const r = signature(f, box(x, 120)); if (!r.ok) throw new Error(r.reason); return r.hsv; };
const green = sig(80), blue = sig(240);
const anchor = (id: string, x: number, y: number, hsv: Anchor["sig"], lost = false): Anchor => ({ id, x, y, sig: hsv, lost });

describe("reconcile", () => {
  it("matches by colour first, even when the other note is nearer", () => {
    const m = reconcile([box(80, 120), box(240, 120)], [anchor("g", 235, 120, green), anchor("b", 85, 120, blue)], f);
    expect(m.map(x => [x.id, x.x])).toEqual(expect.arrayContaining([["g", 80], ["b", 240]]));
  });
  it("two same-colour notes go to the nearest", () => {
    const two = rect(rect(frame(320, 240, WHITE), 80, 120, S, S, GREEN), 240, 120, S, S, GREEN);
    const m = reconcile([box(240, 120), box(80, 120)], [anchor("a", 70, 120, green), anchor("b", 230, 120, green)], two);
    expect(m.find(x => x.id === "a")!.x).toBe(80);
    expect(m.find(x => x.id === "b")!.x).toBe(240);
  });
  it("a lost note whose colour shifted (lighting) falls back to nearest position", () => {
    const shifted = rect(frame(320, 240, WHITE), 100, 100, S, S, [30, 170, 170]);
    const m = reconcile([box(100, 100)], [anchor("g", 90, 110, green, true)], shifted);
    expect(m).toMatchObject([{ id: "g", x: 100, y: 100, byColor: false }]);
  });
  it("never moves a healthy note to a box of another colour", () => {
    expect(reconcile([box(240, 120)], [anchor("g", 200, 120, green)], f)).toEqual([]);
  });
  it("no boxes, no matches", () => { expect(reconcile([], [anchor("g", 80, 120, green, true)], f)).toEqual([]); });
});

function harness(find: () => Promise<FindResult>) {
  const capture = vi.fn(async (): Promise<Capture> => ({ image: "data:image/jpeg;base64,AA", w: 640, h: 480, frame: f, anchors: [] }));
  const apply = vi.fn().mockReturnValue({ changed: false, found: 0 });
  const onFire = vi.fn();
  const findSpy = vi.fn(find);
  return { loop: new ReanchorLoop({ capture, find: findSpy, apply, onFire }), capture, apply, onFire, find: findSpy };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const ok = async (): Promise<FindResult> => ({ ok: true, boxes: [] });

describe("ReanchorLoop", () => {
  it("fires about every 2 s", async () => {
    const h = harness(ok);
    for (let t = 0; t <= 6100; t += 33) { h.loop.tick(t, 0); await flush(); }
    expect(h.find.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(h.find.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("tick returns at once and only one call runs at a time, however slow SAM is", async () => {
    let release: (r: FindResult) => void = () => {};
    const h = harness(() => new Promise<FindResult>(r => { release = r; }));
    const t0 = performance.now();
    for (let t = 0; t < 20000; t += 33) { h.loop.tick(t, 500); await flush(); }
    expect(performance.now() - t0).toBeLessThan(500);
    expect(h.find).toHaveBeenCalledTimes(1);
    release({ ok: true, boxes: [] }); await flush();
    h.loop.tick(21000, 500); await flush();
    expect(h.find).toHaveBeenCalledTimes(2);
  });
  it("fires straight away when a note has been lost over 300 ms", async () => {
    const h = harness(ok);
    h.loop.tick(0, 0); await flush();
    h.loop.tick(1000, 200); await flush();
    expect(h.find).toHaveBeenCalledTimes(1);
    h.loop.tick(1600, 350); await flush();
    expect(h.find).toHaveBeenCalledTimes(2);
  });
  it("backs off while nothing needs fixing, and snaps back when something does", async () => {
    const h = harness(ok);
    let t = 0;
    for (; t < 600_000; t += 100) { h.loop.tick(t, 0); await flush(); }
    expect(h.loop.gap).toBeGreaterThan(BASE_GAP_MS * 4);
    h.apply.mockReturnValue({ changed: true, found: 1 });
    for (const end = t + 40_000; t < end; t += 100) { h.loop.tick(t, 0); await flush(); }
    expect(h.loop.gap).toBe(BASE_GAP_MS);
  });
  it("a note that stays gone slows the lost retries down too", async () => {
    const h = harness(ok);
    for (let t = 0; t < 600_000; t += 100) { h.loop.tick(t, 1000); await flush(); }
    expect(h.find.mock.calls.length).toBeLessThan(40);
  });
  it("pauses on 429 for as long as the server says", async () => {
    const h = harness(async () => ({ ok: false, status: 429, retryAfter: 120 }));
    h.loop.tick(0, 0); await flush();
    for (let t = 100; t < 119_000; t += 100) { h.loop.tick(t, 1000); await flush(); }
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.loop.pausedUntil).toBeGreaterThanOrEqual(119_900);
    h.loop.tick(120_100, 1000); await flush();
    expect(h.find).toHaveBeenCalledTimes(2);
  });
  it("survives a network failure or a failed capture", async () => {
    const h = harness(() => Promise.reject(new Error("offline")));
    h.loop.tick(0, 0); await flush();
    h.capture.mockRejectedValueOnce(new Error("no frame"));
    h.loop.tick(20_000, 0); await flush();
    h.loop.tick(40_000, 0); await flush();
    expect(h.find).toHaveBeenCalledTimes(2);
  });
  it("after stop, a late answer is dropped", async () => {
    let release: (r: FindResult) => void = () => {};
    const h = harness(() => new Promise<FindResult>(r => { release = r; }));
    h.loop.tick(0, 0); await flush();
    h.loop.stop();
    release({ ok: true, boxes: [box(80, 120)] }); await flush();
    expect(h.apply).not.toHaveBeenCalled();
  });
});
