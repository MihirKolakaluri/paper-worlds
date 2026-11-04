import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Level } from "@/schema/level";
import { SURF_MS, surfLevel, surfProgress } from "@/surf/level";

const sample = Level.parse(JSON.parse(readFileSync("public/samples/a.json", "utf8")));

describe("Asteroid Surf", () => {
  it("is a clean page: no platforms, no lava, still a valid level", () => {
    const l = Level.parse(surfLevel(sample));
    expect(l.surf).toBe(true);
    expect(l.solid.flat().some(Boolean)).toBe(false);
    expect(l.lava.flat().some(Boolean)).toBe(false);
    expect(l.warnings).toEqual([]);
  });
  it("has an ending, and a hit costs ground but never goes below the start", () => {
    expect(surfProgress(0, 0, 0).pct).toBe(0);
    expect(surfProgress(SURF_MS - 1, 10, 0).done).toBe(true);
    expect(surfProgress(SURF_MS / 2, 0, 1).ms).toBeCloseTo(SURF_MS * 0.35);
    expect(surfProgress(100, 0, 1).ms).toBe(0);
  });
});
