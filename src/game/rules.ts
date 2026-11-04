import type { Rule } from "@/schema/rule";

// Pure helpers so the rule math can be unit tested without Phaser.
export const clampRaise = (px: number) => Math.max(8, Math.min(64, Math.round(px / 8) * 8 || 8));
export const clampSpeed = (x: number) => Math.max(0.5, Math.min(2.5, x));

/** `raised` and `tiles` remember what this rule did, so × can take it back. */
export type Active = { rule: Rule; fired: number; nextAt: number; raised?: number; tiles?: [number, number][] };

/** After a level reset every rule starts again, except a once rule that caused the reset, which would loop for ever. */
export function rearm(active: Active[], now: number, timerMs: (r: Rule) => number, cause?: Active) {
  for (const a of active) {
    a.raised = 0; a.tiles = [];
    if (a === cause && a.rule.mode === "once") continue;
    a.fired = 0; a.nextAt = now + timerMs(a.rule);
  }
}

/** Which rules fire for this trigger. `once` rules fire a single time. */
export function rulesFor(active: Active[], match: (r: Rule) => boolean): Active[] {
  return active.filter(a => match(a.rule) && (a.rule.mode === "every" || a.fired === 0));
}

export type PlayerSpot = { x: number; feetY: number; headY: number; onFloor: boolean; flipped: boolean; facing: 1 | -1 };

/** Where a "near the player" platform goes, in tiles: under you in the air, ahead and within a jump on the ground. */
export function spawnSpot(p: PlayerSpot, T: number, width: number, height: number, w: number, jumpPx = 72): { x: number; y: number } {
  const col = Math.round(p.x / T), feet = Math.floor(p.feetY / T), head = Math.floor(p.headY / T);
  const up = Math.max(2, Math.round((jumpPx * 0.6) / T));
  const x = p.onFloor ? (p.facing > 0 ? col + 2 : col - 2 - w) : Math.round(p.x / T - w / 2);
  const y = p.onFloor ? (p.flipped ? head + up : feet - up) : (p.flipped ? head - 1 : feet);
  return { x: Math.max(0, Math.min(width - w, x)), y: Math.max(0, Math.min(height - 1, y)) };
}
