import type { Level } from "@/schema/level";

export const SURF_MS = 45_000; // long enough to feel like a run, short enough to finish
const HIT_COST = 0.15;

/** A drawing's hero on a clean page: nothing to land on, just you, the plank and the asteroids. */
export function surfLevel(from: Level): Level {
  const empty = from.solid.map(row => row.map(() => false));
  return { ...from, solid: empty, lava: empty.map(row => [...row]), warnings: [], surf: true };
}

/** Time travelled after a tick. `hits` is how many asteroids landed this tick. */
export function surfProgress(ms: number, deltaMs: number, hits: number) {
  const next = Math.max(0, ms + deltaMs - hits * SURF_MS * HIT_COST);
  return { ms: next, pct: Math.min(100, Math.floor(next / SURF_MS * 100)), done: next >= SURF_MS };
}
