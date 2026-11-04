// SAM 3.1 finds sticky notes. Server only. We use SAM's boxes and ignore its mask tokens on purpose:
// decoding them needs a parser under the SAM License, and a note is a rectangle anyway.
import { meta, MODELS } from "@/lib/meta";

export type Box = { x1: number; y1: number; x2: number; y2: number };

const BOX = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;

/** `<0f>id<|box;...|><|mask;...|>,id<|box;...|>...` to boxes in pixels of a w x h image. Empty text means no matches. */
export function parseSamBoxes(text: string, w: number, h: number): Box[] {
  const out: Box[] = [];
  for (const m of text.matchAll(BOX)) {
    const [x1, y1, x2, y2, sw, sh] = m.slice(1).map(Number);
    if (!sw || !sh) continue;
    const fx = w / sw, fy = h / sh;
    const b = { x1: Math.max(0, x1 * fx), y1: Math.max(0, y1 * fy), x2: Math.min(w - 1, x2 * fx), y2: Math.min(h - 1, y2 * fy) };
    if (b.x2 > b.x1 && b.y2 > b.y1) out.push(b);
  }
  return out;
}

type Sam = { responses: { create(body: never, opts?: never): Promise<{ output_text?: string }> } };

export async function findNotes(image: string, w: number, h: number, client: Sam = meta() as unknown as Sam): Promise<Box[]> {
  const body = {
    model: MODELS.sam,
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "sticky note" },
      { type: "input_image", image_url: image },
    ] }],
    metadata: { mask_encoding: "one_bit" }, // smaller answers; the mask itself is not read
  };
  const resp = await client.responses.create(body as never, { timeout: 15_000, maxRetries: 0 } as never);
  return parseSamBoxes(resp.output_text ?? "", w, h);
}
