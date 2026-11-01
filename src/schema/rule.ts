import { z } from "zod";

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("whistle") }),
  z.object({ type: z.literal("clap") }),
  z.object({ type: z.literal("timer"), sec: z.number().positive().max(60) }),
  z.object({ type: z.literal("touch"), target: z.enum(["goal", "lava"]) }),
]);

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("raise_lava"), px: z.number().min(1).max(64) }),
  z.object({ type: z.literal("flip_gravity") }),
  z.object({ type: z.literal("spawn_platform"), x: z.number(), y: z.number(), w: z.number().positive() }),
  z.object({ type: z.literal("speed"), x: z.number().min(0.25).max(3) }),
  z.object({ type: z.literal("freeze_movers"), sec: z.number().positive().max(30) }),
  z.object({ type: z.literal("reset") }),
]);

/** One spoken or typed rule, compiled by Muse Wonder. `text` is the plain words shown on the chip. */
export const Rule = z.object({
  id: z.string(),
  text: z.string(),
  mode: z.enum(["once", "every"]),
  trigger: Trigger,
  action: Action,
});
export type Rule = z.infer<typeof Rule>;
