import { describe, expect, it } from "vitest";
import { rideVelocity, scribbleWave, scribbleY } from "@/game/ride";

describe("riding the plank", () => {
  it("the hero chases the plank fast and stops on it", () => {
    expect(rideVelocity(500, 500)).toBe(0);
    expect(rideVelocity(510, 500)).toBe(200);
    expect(rideVelocity(5000, 0)).toBe(1400);
    expect(rideVelocity(0, 5000)).toBe(-1400);
  });
});

describe("scribbles", () => {
  it("start gentle and get faster and closer together", () => {
    const a = scribbleWave(0), b = scribbleWave(30_000), c = scribbleWave(600_000);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(b.gapMs).toBeLessThan(a.gapMs);
    expect(c).toEqual(scribbleWave(60_000)); // tops out, so it stays beatable
  });
  it("every third one aims at the hero, so standing still doesn't work", () => {
    expect(scribbleY(3, 0.5, 200, 600)).toBe(200);
    expect(scribbleY(4, 0, 200, 600)).toBe(40);
    expect(scribbleY(4, 1, 200, 600)).toBe(560);
  });
});
