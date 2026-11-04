import { describe, expect, it, vi } from "vitest";
import { MoverSession } from "@/tracking/session";
import { calibrate } from "@/tracking/calibrate";
import type { Mover } from "@/schema/mover";
import { BLUE, GREEN, WHITE, frame, rect } from "./frames";

// The whole path with a fake game: frame in, hook calls out. 320x240 camera onto a 640x320 level.
const LW = 640, LH = 320, S = 40;
const box = (x: number, y: number) => ({ x1: x - S / 2, y1: y - S / 2, x2: x + S / 2, y2: y + S / 2 });
const scene = (x: number, y: number) => rect(frame(320, 240, WHITE), x, y, S, S, GREEN);
function make() {
  const hooks = { addMover: vi.fn<(m: Mover) => void>(), removeMover: vi.fn<(id: string) => void>(), setMoverTarget: vi.fn<(id: string, x: number, y: number) => void>(), setMoverAlpha: vi.fn<(id: string, a: number) => void>(), setRide: vi.fn<(id: string | null) => void>() };
  const s = new MoverSession(hooks, LW, LH, 8);
  const c = calibrate([[0, 0], [320, 0], [320, 240], [0, 240]], LW, LH);
  if (!c.ok) throw new Error(c.error);
  s.setCalibration(c.H);
  return { s, hooks };
}

describe("MoverSession", () => {
  it("a found note becomes a mover with a solid shape at the right level spot", () => {
    const { s, hooks } = make();
    const r = s.addNotes([box(160, 120)], scene(160, 120));
    expect(r).toEqual({ added: 1, warnings: [] });
    const m = hooks.addMover.mock.calls[0][0];
    expect(Mover_parse(m)).toBe(true);
    expect(m.pos.x).toBeCloseTo(320, 3);
    expect(m.pos.y).toBeCloseTo(160, 3);
    expect(m.shape.length).toBe(2); // a plank: always 2 tiles tall, however tall the note looks
    expect(m.shape[0].length).toBe(10); // and 80 wide
    expect(m.shape.flat().every(Boolean)).toBe(true);
    expect(m.color).toMatch(/^#/);
  });
  it("moving the note moves the target in level pixels", () => {
    const { s, hooks } = make();
    s.addNotes([box(160, 120)], scene(160, 120));
    for (let i = 0; i < 20; i++) s.step(scene(160 + i * 4, 120).data, 320, 240, i * 33);
    const [id, x, y] = hooks.setMoverTarget.mock.lastCall!;
    expect(id).toBe("note-1");
    expect(Math.abs(x - (160 + 19 * 4) * 2)).toBeLessThan(30);
    expect(Math.abs(y - 160)).toBeLessThan(5);
  });
  it("keeps the platform inside the level", () => {
    const { s, hooks } = make();
    s.addNotes([box(160, 120)], scene(160, 120));
    for (let i = 0; i < 12; i++) s.step(scene(160 + i * 20, 120).data, 320, 240, i * 33);
    const x = hooks.setMoverTarget.mock.lastCall![1];
    expect(x).toBeLessThanOrEqual(LW - 40);
  });
  it("hand over the note: holds, fades, removes, then adds it back where it reappears", () => {
    const { s, hooks } = make();
    s.addNotes([box(160, 120)], scene(160, 120));
    s.step(scene(160, 120).data, 320, 240, 0);
    const none = frame(320, 240, WHITE).data;
    expect(s.step(none, 320, 240, 400).lostMs).toBe(400);
    expect(hooks.removeMover).not.toHaveBeenCalled();
    s.step(none, 320, 240, 750);
    expect(hooks.setMoverAlpha.mock.lastCall![1]).toBeCloseTo(0.5, 1);
    s.step(none, 320, 240, 1100);
    expect(hooks.removeMover).toHaveBeenCalledWith("note-1");
    hooks.addMover.mockClear();
    s.step(none, 320, 240, 1200);
    expect(hooks.removeMover).toHaveBeenCalledTimes(1);
    s.step(scene(100, 60).data, 320, 240, 1500);
    expect(hooks.addMover).toHaveBeenCalledTimes(1);
    expect(hooks.addMover.mock.calls[0][0].pos.x).toBeCloseTo(200, -1);
    expect(hooks.setMoverAlpha.mock.lastCall![1]).toBe(1);
  });
  it("find again skips notes it already has, and adds the new one", () => {
    const { s, hooks } = make();
    const two = rect(scene(100, 120), 240, 120, S, S, BLUE);
    s.addNotes([box(100, 120)], two);
    s.step(two.data, 320, 240, 0);
    expect(s.addNotes([box(100, 120), box(240, 120)], two)).toEqual({ added: 1, warnings: [] });
    expect(hooks.addMover).toHaveBeenCalledTimes(2);
    expect(hooks.addMover.mock.lastCall![0].id).toBe("note-2");
  });
  it("a pale note is skipped with a plain reason", () => {
    const { s, hooks } = make();
    const r = s.addNotes([box(160, 120)], rect(frame(320, 240, [176, 120, 72]), 160, 120, S, S, [245, 240, 215]));
    expect(r.added).toBe(0);
    expect(r.warnings[0]).toMatch(/pale/i);
    expect(hooks.addMover).not.toHaveBeenCalled();
  });
  it("remove last takes the newest off, and clear takes all", () => {
    const { s, hooks } = make();
    const two = rect(scene(100, 120), 240, 120, S, S, BLUE);
    s.addNotes([box(100, 120), box(240, 120)], two);
    s.removeLast();
    expect(hooks.removeMover).toHaveBeenLastCalledWith("note-2");
    expect(s.count).toBe(1);
    s.clear();
    expect(hooks.removeMover).toHaveBeenLastCalledWith("note-1");
    expect(s.count).toBe(0);
  });
  it("a re-anchor rescues a lost note and re-learns its colour from that frame", () => {
    const { s, hooks } = make();
    s.addNotes([box(160, 120)], scene(160, 120));
    s.step(scene(160, 120).data, 320, 240, 0);
    s.step(frame(320, 240, WHITE).data, 320, 240, 1200); // gone
    const dim: [number, number, number] = [30, 170, 170]; // same note, colour shifted by the light
    const f = rect(frame(320, 240, WHITE), 200, 100, S, S, dim);
    const anchors = s.anchors();
    expect(anchors[0].lost).toBe(true);
    expect(s.applyBoxes([box(200, 100)], { frame: f, anchors }, 1300)).toEqual({ changed: true, found: 1 });
    s.step(f.data, 320, 240, 1333);
    expect(hooks.setMoverTarget.mock.lastCall![1]).toBeCloseTo(400, -1);
    expect(s.step(f.data, 320, 240, 1366).lostMs).toBe(0);
  });
  it("found counts only rescued notes, so a note still on the table can't hide one that stays gone", () => {
    const { s } = make();
    const two = () => rect(scene(100, 120), 240, 120, S, S, BLUE);
    s.addNotes([box(100, 120), box(240, 120)], two());
    s.step(two().data, 320, 240, 0);
    const onlyBlue = () => rect(frame(320, 240, WHITE), 240, 120, S, S, BLUE); // green was taken off the table
    s.step(onlyBlue().data, 320, 240, 1200);
    const anchors = s.anchors();
    expect(anchors.filter(a => a.lost).length).toBe(1);
    expect(s.applyBoxes([box(240, 120)], { frame: onlyBlue(), anchors }, 1300).found).toBe(0);
  });
  it("the first note becomes the controller, and removing it hands control back to the keys", () => {
    const { s, hooks } = make();
    s.addNotes([box(160, 120)], scene(160, 120));
    expect(hooks.setRide.mock.lastCall![0]).toMatch(/^note-/);
    s.removeLast();
    expect(hooks.setRide.mock.lastCall![0]).toBeNull();
  });
  it("a wrong SAM box on the desk can't teach the tracker that the desk is the note", () => {
    const WOOD: [number, number, number] = [176, 128, 84];
    const { s } = make();
    const desk = () => rect(frame(320, 240, WOOD), 100, 120, S, S, GREEN);
    s.addNotes([box(100, 120)], desk());
    s.step(desk().data, 320, 240, 0);
    const lost = () => frame(320, 240, WOOD); // the hand took the note away
    s.step(lost().data, 320, 240, 1200);
    const anchors = s.anchors(), before = anchors[0].sig;
    expect(anchors[0].lost).toBe(true);
    expect(s.applyBoxes([box(104, 124)], { frame: lost(), anchors }, 1300)).toEqual({ changed: false, found: 0 });
    expect(s.anchors()[0].sig).toEqual(before);
  });
  it("a re-anchor that agrees with the tracker changes nothing, even if the note moved during the call", () => {
    const { s } = make();
    s.addNotes([box(100, 120)], scene(100, 120));
    s.step(scene(100, 120).data, 320, 240, 0);
    const anchors = s.anchors(), f = scene(100, 120);
    s.step(scene(180, 120).data, 320, 240, 1000); // SAM took a second and the note kept moving
    expect(s.applyBoxes([box(100, 120)], { frame: f, anchors }, 1033)).toEqual({ changed: false, found: 0 });
  });
  it("a re-anchor pulls a drifted tracker back by the error it had when the frame was taken", () => {
    const { s } = make();
    s.addNotes([box(100, 120)], scene(100, 120));
    s.step(scene(100, 120).data, 320, 240, 0);
    const anchors = s.anchors(), f = scene(160, 120); // SAM saw the note 60 px from where the tracker thought
    expect(s.applyBoxes([box(160, 120)], { frame: f, anchors }, 100)).toEqual({ changed: true, found: 0 });
  });
});

function Mover_parse(m: Mover) { return typeof m.id === "string" && m.hsv.sMin > 0 && m.shape.length > 0; }
