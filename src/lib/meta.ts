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
