import { describe, expect, it } from "vitest";
import { Level } from "@/schema/level";
import { Mover } from "@/schema/mover";
import { Rule } from "@/schema/rule";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, v: T) => schema.parse(JSON.parse(JSON.stringify(v)));

describe("schemas", () => {
  it("Level round-trips", () => {
    const lv = { width: 2, height: 2, tileSize: 8 as const, spawn: { x: 0, y: 0 }, goal: { x: 1, y: 0, w: 1, h: 1 },
      solid: [[false, false], [true, true]], lava: [[false, false], [false, false]], warnings: [] };
    expect(roundTrip(Level, lv)).toEqual(lv);
  });
  it("Level rejects a wrong tile size", () => {
    expect(() => Level.parse({ width: 1, height: 1, tileSize: 16, spawn: { x: 0, y: 0 }, goal: { x: 0, y: 0, w: 1, h: 1 }, solid: [[false]], lava: [[false]], warnings: [] })).toThrow();
  });
  it("Mover round-trips", () => {
    const m = { id: "n1", color: "green", hsv: { hMin: 70, hMax: 110, sMin: 0.3, vMin: 0.3 }, shape: [[true]], pos: { x: 3, y: 4 } };
    expect(roundTrip(Mover, m)).toEqual(m);
  });
  it("Rule round-trips and rejects unknown actions", () => {
    const r = { id: "r1", text: "lava rises when I whistle", mode: "every" as const, trigger: { type: "whistle" as const }, action: { type: "raise_lava" as const, px: 8 } };
    expect(roundTrip(Rule, r)).toEqual(r);
    expect(() => Rule.parse({ ...r, action: { type: "jetpack" } })).toThrow();
  });
});
