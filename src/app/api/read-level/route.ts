import { guarded } from "@/lib/guard";
import { meta, MODELS } from "@/lib/meta";
import { z } from "zod";

export const maxDuration = 60;

const Body = z.object({ image: z.string().startsWith("data:image/"), w: z.number().int().positive(), h: z.number().int().positive() });

const SCHEMA = {
  type: "object",
  properties: { marks: { type: "array", items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["platform", "lava", "goal", "spawn"] },
      box: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
    },
    required: ["kind", "box"], additionalProperties: false } } },
  required: ["marks"], additionalProperties: false,
};

const prompt = (w: number, h: number) => `This photo shows a 2D platformer level hand-drawn in pen on paper.
Find every mark and label it:
- platform: a line or shape the player can stand on (pen strokes)
- lava: any area colored red
- goal: the flag
- spawn: the stick figure (where the player starts)
Return a box for each mark as [x1, y1, x2, y2] in pixels of this ${w}x${h} image, tight around the ink.
Ignore the paper edge, shadows and anything off the paper.`;

const Marks = z.object({ marks: z.array(z.object({ kind: z.enum(["platform", "lava", "goal", "spawn"]), box: z.tuple([z.number(), z.number(), z.number(), z.number()]) })) });

export const POST = guarded(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > 3_000_000) return Response.json({ error: "That photo is too big. Try again, it will be shrunk first." }, { status: 413 });
  const parsed = Body.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return Response.json({ error: "No photo came through. Snap it again." }, { status: 400 });
  const { image, w, h } = parsed.data;

  const t0 = Date.now();
  type Parsed = z.infer<typeof Marks>;
  let data: Parsed | null = null;
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
    let text = "";
    try {
      const resp = await meta().responses.create({
        model: MODELS.spark,
        input: [{ type: "message", role: "user", content: [
          { type: "input_text", text: prompt(w, h) },
          { type: "input_image", image_url: image, detail: "auto" },
        ] }],
        text: { format: { type: "json_schema", name: "level_marks", schema: SCHEMA, strict: true } },
        max_output_tokens: 6000,
      });
      text = resp.output_text;
      if (!text) console.error(`read-level attempt ${attempt} empty output`, resp.status, JSON.stringify(resp.incomplete_details ?? null), JSON.stringify(resp.usage ?? null));
    } catch (e) {
      console.error(`read-level attempt ${attempt} spark error`, e);
      if (attempt === 2) return Response.json({ error: "The AI didn't answer. Wait a moment and try again." }, { status: 502 });
      continue;
    }
    const out = Marks.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
    if (out.success) data = out.data;
    else console.error(`read-level attempt ${attempt} unparsable output:`, text.slice(0, 500));
  }
  const ms = Date.now() - t0;
  if (!data) return Response.json({ error: "I couldn't read that drawing. Try again, or snap a clearer photo." }, { status: 502 });
  const out = { data };

  const kinds = new Set(out.data.marks.map(m => m.kind));
  if (!kinds.has("spawn")) return Response.json({ error: "I couldn't find the stick figure. Draw one where the player starts and snap again." }, { status: 422 });
  if (!kinds.has("goal")) return Response.json({ error: "I couldn't find the flag. Draw a flag and snap again." }, { status: 422 });
  return Response.json({ marks: out.data.marks, w, h, ms });
});
