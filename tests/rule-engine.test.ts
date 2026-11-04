import { describe, expect, it, vi } from "vitest";
import type { Hooks, HudEvent } from "@/game/hooks";
import { clampSpeed, rearm, rulesFor, spawnSpot, type Active } from "@/game/rules";
import { createEngine, MAX_RULES } from "@/rules/engine";
import { IMMEDIATE_SEC } from "@/rules/compile";
import type { Rule } from "@/schema/rule";

function fakeHooks() {
  const events = new Set<(e: HudEvent) => void>();
  const hooks: Hooks = {
    input: { left: false, right: false, jump: false },
    setMoverAlpha: vi.fn(), setRide: vi.fn(), setMoverTarget: vi.fn(), addMover: vi.fn(), removeMover: vi.fn(),
    applyRule: vi.fn(), removeRule: vi.fn(), emit: vi.fn(), restart: vi.fn(),
    onTick: () => () => {},
    onEvent: cb => { events.add(cb); return () => events.delete(cb); },
  };
  return { hooks, send: (e: HudEvent) => events.forEach(cb => cb(e)) };
}
const rule = (id: string, over: Partial<Rule> = {}): Rule => ({
  id, text: `rule ${id}`, mode: "every", trigger: { type: "clap" }, action: { type: "flip_gravity" }, ...over,
});

describe("rule engine", () => {
  it("applies a rule through hooks and lists it", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    expect(e.add(rule("a"))).toEqual({ ok: true });
    expect(hooks.applyRule).toHaveBeenCalledTimes(1);
    expect(e.snapshot().map(r => r.rule.id)).toEqual(["a"]);
  });
  it("stops at 5 rules with a plain message", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    for (let i = 0; i < MAX_RULES; i++) expect(e.add(rule(`r${i}`)).ok).toBe(true);
    const out = e.add(rule("extra"));
    expect(out.ok).toBe(false);
    expect(hooks.applyRule).toHaveBeenCalledTimes(MAX_RULES);
    expect(e.full()).toBe(true);
  });
  it("× removes one and leaves the others", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.add(rule("a")); e.add(rule("b"));
    e.remove("a");
    expect(hooks.removeRule).toHaveBeenCalledWith("a");
    expect(e.snapshot().map(r => r.rule.id)).toEqual(["b"]);
  });
  it("clear all removes every rule", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.add(rule("a")); e.add(rule("b"));
    e.clear();
    expect(hooks.removeRule).toHaveBeenCalledTimes(2);
    expect(e.snapshot()).toEqual([]);
  });
  it("adding the same preset twice does nothing the second time", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.add(rule("a")); expect(e.add(rule("a")).ok).toBe(true);
    expect(hooks.applyRule).toHaveBeenCalledTimes(1);
    expect(e.snapshot()).toHaveLength(1);
  });
  it("rejects a malformed rule instead of passing it to the game", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    expect(e.add({ ...rule("a"), trigger: { type: "timer", sec: 0 } }).ok).toBe(false);
    expect(hooks.applyRule).not.toHaveBeenCalled();
  });
  it("clamps wild amounts on rules that skip the compiler, like presets", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.add(rule("a", { action: { type: "speed", x: 3 } }));
    e.add(rule("b", { action: { type: "raise_lava", px: 1 } }));
    const applied = vi.mocked(hooks.applyRule).mock.calls.map(c => c[0].action);
    expect(applied).toEqual([{ type: "speed", x: 2.5 }, { type: "raise_lava", px: 8 }]);
  });
  it("a reset with no trigger restarts now and keeps no rule (it would loop forever)", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    const out = e.add(rule("a", { mode: "once", trigger: { type: "timer", sec: IMMEDIATE_SEC }, action: { type: "reset" } }));
    expect(out.ok).toBe(true);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
    expect(hooks.applyRule).not.toHaveBeenCalled();
    expect(e.snapshot()).toEqual([]);
  });
  it("fire() sends whistle and clap through hooks.emit", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.fire("whistle"); e.fire("clap");
    expect(vi.mocked(hooks.emit).mock.calls.flat()).toEqual(["whistle", "clap"]);
  });
  it("counts fires for the chip and clears them when the level restarts", () => {
    const { hooks, send } = fakeHooks(); const e = createEngine(hooks);
    const stop = e.subscribe(() => {});
    e.add(rule("a"));
    send({ type: "rule", id: "a" }); send({ type: "rule", id: "a" });
    expect(e.snapshot()[0].fired).toBe(2);
    send({ type: "start" });
    expect(e.snapshot()[0].fired).toBe(0);
    stop();
  });
  it("snapshot is stable between changes (useSyncExternalStore needs that)", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    e.add(rule("a"));
    expect(e.snapshot()).toBe(e.snapshot());
  });
  it("needsSound says when a whistle or clap rule is waiting", () => {
    const { hooks } = fakeHooks(); const e = createEngine(hooks);
    expect(e.needsSound()).toBe(false);
    e.add(rule("a"));
    expect(e.needsSound()).toBe(true);
  });
});

describe("once and every", () => {
  const act = (r: Rule, fired: number): Active => ({ rule: r, fired, nextAt: 0 });
  it("once fires one time, every keeps firing", () => {
    const list = [act(rule("once", { mode: "once" }), 1), act(rule("every"), 7), act(rule("fresh", { mode: "once" }), 0)];
    expect(rulesFor(list, () => true).map(a => a.rule.id)).toEqual(["every", "fresh"]);
  });
  it("speed stays within the game's limits", () => { expect(clampSpeed(99)).toBe(2.5); expect(clampSpeed(0)).toBe(0.5); });
});

describe("spawnSpot", () => {
  const base = { x: 100, feetY: 200, headY: 180, onFloor: false, flipped: false, facing: 1 as const };
  const T = 8, width = 80, height = 40, w = 10;
  it("in the air it lands under your feet, centred on you", () => {
    expect(spawnSpot(base, T, width, height, w)).toEqual({ x: 8, y: 25 });
  });
  it("on the ground it goes ahead of you and up, within a jump", () => {
    const s = spawnSpot({ ...base, onFloor: true }, T, width, height, w, 72);
    expect(s.x).toBeGreaterThan(12);
    expect(s.y).toBeLessThan(25);
    expect(25 - s.y).toBeLessThanOrEqual(72 / T);
  });
  it("facing left on the ground it goes left", () => {
    const s = spawnSpot({ ...base, onFloor: true, facing: -1 }, T, width, height, w, 72);
    expect(s.x + w).toBeLessThanOrEqual(12);
  });
  it("with gravity flipped, in the air it goes above your head", () => {
    expect(spawnSpot({ ...base, flipped: true }, T, width, height, w).y).toBe(21);
  });
  it("never leaves the level", () => {
    const s = spawnSpot({ ...base, x: 0, feetY: 9999 }, T, width, height, w);
    expect(s.x).toBe(0); expect(s.y).toBe(39);
    expect(spawnSpot({ ...base, x: 9999 }, T, width, height, w).x).toBe(70);
  });
});

describe("rearm after a level reset", () => {
  const timer = { type: "timer", sec: 10 } as const;
  const reset = (id: string, mode: "once" | "every"): Rule => ({ id, text: id, mode, trigger: timer, action: { type: "reset" } });
  const lava: Rule = { id: "l", text: "l", mode: "once", trigger: timer, action: { type: "raise_lava", px: 8 } };
  it("a used once reset stays used, or it would restart the level for ever", () => {
    const a: Active = { rule: reset("a", "once"), fired: 1, nextAt: 0 };
    rearm([a], 5000, () => 10_000);
    expect(a.fired).toBe(1);
  });
  it("two once resets can't keep starting each other", () => {
    const a: Active = { rule: reset("a", "once"), fired: 1, nextAt: 0 }, b: Active = { rule: reset("b", "once"), fired: 1, nextAt: 0 };
    rearm([a, b], 5000, () => 10_000);
    expect([a.fired, b.fired]).toEqual([1, 1]);
  });
  it("a once reset that hasn't fired yet, and every other rule, start again", () => {
    const waiting: Active = { rule: reset("w", "once"), fired: 0, nextAt: 0 }, once: Active = { rule: lava, fired: 1, nextAt: 0 }, every: Active = { rule: reset("c", "every"), fired: 3, nextAt: 0 };
    rearm([waiting, once, every], 5000, () => 10_000);
    for (const a of [waiting, once, every]) expect(a).toMatchObject({ fired: 0, nextAt: 15_000 });
  });
});
