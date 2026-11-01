import { z } from "zod";

/** A real object under the camera (a sticky note) that becomes a moving platform. */
export const Mover = z.object({
  id: z.string(),
  color: z.string(),
  hsv: z.object({ hMin: z.number(), hMax: z.number(), sMin: z.number(), vMin: z.number() }),
  shape: z.array(z.array(z.boolean())),
  pos: z.object({ x: z.number(), y: z.number() }),
});
export type Mover = z.infer<typeof Mover>;
