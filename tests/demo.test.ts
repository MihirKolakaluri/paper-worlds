import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Level } from "@/schema/level";
import { Rule } from "@/schema/rule";
import { checkReach, respawnLavaCap } from "@/game/reach";
import { SAMPLES, sampleById } from "@/demo/samples";
import { PRESETS } from "@/demo/presets";
import { demoMover, pointerToLevel } from "@/demo/mouse";

describe("Try it now samples", () => {
  it("has two samples and falls back to the first for an unknown id", () => {
    expect(SAMPLES.length).toBe(2);
    expect(sampleById("nope")).toBe(SAMPLES[0]);
    expect(sampleById(SAMPLES[1].id)).toBe(SAMPLES[1]);
  });
  it.each(["a", "b"])("sample %s is a valid level you can finish", id => {
    const level = Level.parse(JSON.parse(readFileSync(`public/samples/${id}.json`, "utf8")));
    expect(level.image).toBe(`/samples/${id}.jpg`);
    expect(checkReach(level)).toEqual({ landed: true, reachable: true });
  });
  it.each(["a", "b"])("sample %s: risen lava always drops below where you land after a fall", id => {
    const level = Level.parse(JSON.parse(readFileSync(`public/samples/${id}.json`, "utf8")));
    const H = level.height * level.tileSize, deathLine = H - respawnLavaCap(level) + 2;
    let r = Math.ceil(level.spawn.y); const c = Math.floor(level.spawn.x);
    while (r < level.height && !level.solid[r][c]) r++;
    expect(r).toBeLessThan(level.height);
    expect(r * level.tileSize).toBeLessThan(deathLine);
  });
});

describe("preset rules", () => {
  it("are three valid rules with unique ids, so they cost no AI call", () => {
    expect(PRESETS.length).toBe(3);
    PRESETS.forEach(p => Rule.parse(p.rule));
    expect(new Set(PRESETS.map(p => p.rule.id)).size).toBe(3);
  });
});

describe("mouse platform", () => {
  const level = { width: 100, height: 50, tileSize: 8 as const };
  const rect = { left: 10, top: 20, width: 400, height: 200 };
  it("maps a pointer on the canvas to level pixels", () => {
    expect(pointerToLevel(210, 120, rect, level)).toEqual({ x: 400, y: 200 });
  });
  it("keeps the platform inside the level when the pointer leaves the canvas", () => {
    expect(pointerToLevel(-500, 9999, rect, level)).toEqual({ x: 0, y: 400 });
  });
  it("starts the platform in the middle of the level", () => {
    const m = demoMover(level);
    expect(m.pos).toEqual({ x: 400, y: 200 });
    expect(m.shape.length).toBeGreaterThan(0);
  });
});
