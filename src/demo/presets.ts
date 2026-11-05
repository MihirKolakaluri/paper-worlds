import type { Rule } from "@/schema/rule";
import { IMMEDIATE_SEC } from "@/rules/compile";

// One-click rules for Try it now. They apply directly, so they never call the AI.
export const PRESETS: { label: string; rule: Rule }[] = [
  { label: "Lava rises every 5 seconds", rule: { id: "preset-lava", text: "Lava rises every 5 seconds", mode: "every", trigger: { type: "timer", sec: 5 }, action: { type: "raise_lava", px: 24 } } },
  { label: "Flip gravity every 20 seconds", rule: { id: "preset-flip", text: "Flip gravity every 20 seconds", mode: "every", trigger: { type: "timer", sec: 20 }, action: { type: "flip_gravity" } } },
  { label: "Double speed", rule: { id: "preset-speed", text: "Double speed", mode: "once", trigger: { type: "timer", sec: IMMEDIATE_SEC }, action: { type: "speed", x: 2 } } },
];
