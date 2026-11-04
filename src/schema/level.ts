import { z } from "zod";

const grid = z.array(z.array(z.boolean()));

/** A playable level, built from one photo of a drawing. Coordinates are in tiles. */
export const Level = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileSize: z.literal(8),
  image: z.string().optional(),
  spawn: z.object({ x: z.number(), y: z.number(), w: z.number().positive().optional(), h: z.number().positive().optional() }),
  goal: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  solid: grid,
  lava: grid,
  warnings: z.array(z.string()),
  /** Asteroid Surf: a clean page you ride through, with an ending instead of a flag. */
  surf: z.boolean().optional(),
  /** Full jump height in px, tuned so the drawn level is beatable. Missing = default from the figure size. */
  jumpH: z.number().positive().optional(),
});
export type Level = z.infer<typeof Level>;
