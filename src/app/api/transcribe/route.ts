import { guarded } from "@/lib/guard";
import { transcribeWav } from "@/lib/meta";
import { VOICE_ON } from "@/rules/voice/flag";

export const maxDuration = 30;

const MAX_BYTES = 1_000_000; // 15 s of 16 kHz 16-bit mono is 480 KB

const isWav = (b: Uint8Array) => b.length > 44 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";

export const POST = guarded(async (req: Request) => {
  if (!VOICE_ON) return Response.json({ error: "Voice is off right now. Type your rule instead." }, { status: 404 });
  const wav = await req.arrayBuffer();
  if (wav.byteLength > MAX_BYTES) return Response.json({ error: "That was too long. Keep it under 15 seconds." }, { status: 413 });
  if (!isWav(new Uint8Array(wav))) return Response.json({ error: "No audio came through. Try again." }, { status: 400 });

  const t0 = Date.now();
  try {
    const text = (await transcribeWav(wav)).trim();
    if (!text) return Response.json({ error: "I didn't catch that. Try again, or type it." }, { status: 422 });
    return Response.json({ text, ms: Date.now() - t0 });
  } catch (e) {
    console.error("transcribe failed", e);
    return Response.json({ error: "The AI didn't hear that. Wait a moment and try again, or type it." }, { status: 502 });
  }
});
