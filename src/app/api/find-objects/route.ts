import { FIND_BUDGET, guarded } from "@/lib/guard";
import { findNotes } from "@/lib/sam";
import { z } from "zod";

export const maxDuration = 30;

const Body = z.object({ image: z.string().startsWith("data:image/"), w: z.number().int().positive().max(4096), h: z.number().int().positive().max(4096) });

export const POST = guarded(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > 2_000_000) return Response.json({ error: "That camera frame is too big." }, { status: 413 });
  const parsed = Body.safeParse((() => { try { return JSON.parse(raw || "{}"); } catch { return null; } })());
  if (!parsed.success) return Response.json({ error: "No camera frame came through. Try again." }, { status: 400 });
  const { image, w, h } = parsed.data;

  const t0 = Date.now();
  try {
    const boxes = await findNotes(image, w, h);
    return Response.json({ boxes, w, h, ms: Date.now() - t0 });
  } catch (e) {
    console.error("find-objects sam error", e);
    return Response.json({ error: "The AI didn't answer. Wait a moment and try again." }, { status: 502 });
  }
}, FIND_BUDGET);
