import OpenAI from "openai";

// Server only. Never import this from a client component: it reads MODEL_API_KEY.
if (typeof window !== "undefined") throw new Error("meta.ts must only run on the server");

export const MODELS = {
  spark: "muse-spark-1.3",
  wonder: "muse-wonder-1.0",
  sam: "sam-3.1",
  transcribe: "muse-voice-transcribe-1.0",
} as const;

let client: OpenAI | null = null;
export function meta(): OpenAI {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");
  client ??= new OpenAI({ apiKey, baseURL: "https://api.meta.ai/v1" });
  return client;
}

const TRANSCRIBE_TIMEOUT_MS = 15_000;
const KEYWORDS = ["lava", "gravity", "whistle", "clap", "platform", "flip", "speed", "freeze", "goal"];

/** POST /v1/asr/transcribe is not an OpenAI style route: multipart with a JSON `request` part and a WAV `audio` part. */
export async function transcribeWav(wav: ArrayBuffer): Promise<string> {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: MODELS.transcribe, audioEncoding: "WAV", mode: "PUSH_TO_TALK", keywords: KEYWORDS, languageBias: ["English"] })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "talk.wav");
  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, body: form, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { transcript?: string };
  return body.transcript ?? "";
}
