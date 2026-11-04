import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetGuardForTests } from "@/lib/guard";
import { POST } from "@/app/api/transcribe/route";
import { encodeWav } from "@/rules/voice/record";

const wav = () => encodeWav(new Float32Array(8000), 16000);
const post = (body: BodyInit | null, type = "audio/wav") => POST(new Request("http://x/api/transcribe", { method: "POST", headers: { "content-type": type }, body }));
const answer = (json: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(json), { status }));

describe("/api/transcribe", () => {
  beforeEach(() => { _resetGuardForTests(); vi.stubEnv("MODEL_API_KEY", "test-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("sends Meta the multipart form its docs ask for, and returns the text", async () => {
    const f = answer({ sessionId: "s", transcript: "make the lava rise", audioDurationMs: 500, turns: [] });
    vi.stubGlobal("fetch", f);
    const res = await post(wav());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "make the lava rise" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const form = init.body as FormData;
    const request = JSON.parse(await (form.get("request") as Blob).text());
    expect(request).toMatchObject({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" });
    expect((form.get("request") as Blob).type).toBe("application/json");
    expect((form.get("audio") as Blob).type).toBe("audio/wav");
    expect((form.get("audio") as Blob).size).toBe(wav().byteLength);
  });
  it("refuses anything that isn't a WAV before spending a call", async () => {
    const f = answer({}); vi.stubGlobal("fetch", f);
    expect((await post(new Uint8Array(100).buffer)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses more than 15 s of audio", async () => {
    const f = answer({}); vi.stubGlobal("fetch", f);
    const big = new Uint8Array(1_100_000); big.set(new Uint8Array(wav()).subarray(0, 44));
    expect((await post(big.buffer)).status).toBe(413);
    expect(f).not.toHaveBeenCalled();
  });
  it("silence gets a plain try again", async () => {
    vi.stubGlobal("fetch", answer({ sessionId: "s", transcript: "  ", audioDurationMs: 500, turns: [] }));
    const res = await post(wav());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/catch/i);
  });
  it("a Meta error becomes a plain error and never leaks details", async () => {
    vi.stubGlobal("fetch", answer({ message: "secret internal thing" }, 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(wav());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
  it("a network failure is a plain error too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(wav())).status).toBe(502);
  });
});
