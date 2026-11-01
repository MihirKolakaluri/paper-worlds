import type { Rule } from "@/schema/rule";

// Pure helpers so the rule math can be unit tested without Phaser.
export const clampRaise = (px: number) => Math.max(8, Math.min(64, Math.round(px / 8) * 8 || 8));
export const clampSpeed = (x: number) => Math.max(0.5, Math.min(2.5, x));

export type Active = { rule: Rule; fired: number; nextAt: number };

/** Which rules fire for this trigger. `once` rules fire a single time. */
export function rulesFor(active: Active[], match: (r: Rule) => boolean): Active[] {
  return active.filter(a => match(a.rule) && (a.rule.mode === "every" || a.fired === 0));
}
