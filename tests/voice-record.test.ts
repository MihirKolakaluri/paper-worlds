import { describe, expect, it } from "vitest";
import { downsample, encodeWav, MAX_TALK_SEC, MIC_CONSTRAINTS, micErrorMessage, Take, TALK_RATE } from "@/rules/voice/record";

const ascii = (v: DataView, at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));
const tone = (hz: number, rate: number, sec: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * sec) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("encodeWav", () => {
  const n = 1600, wav = encodeWav(tone(440, 16000, 0.1), 16000), v = new DataView(wav);
  it("writes a correct 16 kHz mono 16-bit PCM header", () => {
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // bytes a second
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe("data");
  });
  it("has the right lengths", () => {
    expect(wav.byteLength).toBe(44 + n * 2);
    expect(v.getUint32(40, true)).toBe(n * 2);
    expect(v.getUint32(4, true)).toBe(36 + n * 2);
  });
  it("scales samples and clips instead of wrapping", () => {
    const c = new DataView(encodeWav(Float32Array.from([0, 1, -1, 2, -2, 0.5]), 16000));
    expect([0, 1, 2, 3, 4, 5].map(i => c.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("downsample", () => {
  it("48 kHz to 16 kHz keeps the duration", () => { expect(downsample(tone(440, 48000, 1), 48000).length).toBe(16000); });
  it("44.1 kHz to 16 kHz keeps the duration", () => { expect(downsample(tone(440, 44100, 1), 44100).length).toBe(16000); });
  it("leaves 16 kHz alone", () => { const x = tone(440, 16000, 0.1); expect(downsample(x, 16000)).toBe(x); });
  it("keeps a speech band tone", () => { expect(rms(downsample(tone(440, 48000, 0.5), 48000))).toBeGreaterThan(0.33); });
  it("damps what can't fit at 16 kHz", () => { expect(rms(downsample(tone(15000, 48000, 0.5), 48000))).toBeLessThan(0.2); });
});

describe("Take", () => {
  it("stops at the 15 s cap", () => {
    const t = new Take(48000);
    const frame = new Float32Array(4800);
    let capped = false, pushes = 0;
    while (!capped && pushes < 1000) { capped = t.push(frame); pushes++; }
    expect(capped).toBe(true);
    expect(pushes).toBe(MAX_TALK_SEC * 10);
    expect(t.seconds).toBe(MAX_TALK_SEC);
    expect(t.push(frame)).toBe(true);
    expect(t.seconds).toBe(MAX_TALK_SEC);
  });
  it("copies frames, since the audio callback reuses its buffer", () => {
    const t = new Take(16000), f = new Float32Array(160).fill(0.5);
    t.push(f); f.fill(0);
    const v = new DataView(t.wav());
    expect(v.getInt16(44, true)).toBe(16384);
  });
  it("makes a 16 kHz wav of the right length from 48 kHz audio", () => {
    const t = new Take(48000); t.push(tone(440, 48000, 0.5));
    const wav = t.wav();
    expect(new DataView(wav).getUint32(24, true)).toBe(TALK_RATE);
    expect(wav.byteLength).toBe(44 + 8000 * 2);
  });
});

describe("mic setup", () => {
  it("turns off everything that would mangle a whistle or a clap", () => {
    expect(MIC_CONSTRAINTS).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  });
  it("explains a denied or missing mic in plain words", () => {
    expect(micErrorMessage(new DOMException("x", "NotAllowedError"))).toMatch(/blocked/i);
    expect(micErrorMessage(new DOMException("x", "NotFoundError"))).toMatch(/no mic/i);
    expect(micErrorMessage(new Error("?"))).toMatch(/type/i);
  });
});
