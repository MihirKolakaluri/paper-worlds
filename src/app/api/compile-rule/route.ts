import { guarded } from "@/lib/guard";
import { meta, MODELS } from "@/lib/meta";
import { compileSentence, MAX_SENTENCE, wonderRequest } from "@/rules/compile";
import { z } from "zod";

export const maxDuration = 60;

const WONDER_TIMEOUT_MS = 20_000; // minimal effort took 2.5 to 10 s when measured
const Body = z.object({ text: z.string().trim().min(1).max(MAX_SENTENCE) });

export const POST = guarded(async (req: Request) => {
  const raw = await req.text();
  const parsed = Body.safeParse((() => { try { return JSON.parse(raw || "{}"); } catch { return null; } })());
  if (!parsed.success) return Response.json({ error: `Type a rule, up to ${MAX_SENTENCE} letters.` }, { status: 400 });

  const t0 = Date.now();
  const out = await compileSentence(parsed.data.text, async (sentence, note) => {
    const resp = await meta().responses.create(wonderRequest(MODELS.wonder, sentence, note), { timeout: WONDER_TIMEOUT_MS, maxRetries: 0 });
    return resp.output_text;
  }, crypto.randomUUID());
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ rule: out.rule, ms: Date.now() - t0 });
});
