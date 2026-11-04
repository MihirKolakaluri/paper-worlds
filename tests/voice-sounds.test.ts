import { describe, expect, it } from "vitest";
import { analyze, calibrationFrom, DEFAULT_CALIBRATION, FRAME, SoundDetector, type Sound } from "@/rules/voice/sounds";

const RATE = 48000;
const secs = (s: number) => Math.round(s * RATE);

function rng(seed = 7) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; }; }

/** A timeline of silence with a little room noise; sounds are mixed in at given times. */
function room(sec: number, noise = 0.002, seed = 1) { const r = rng(seed); return Float32Array.from({ length: secs(sec) }, () => r() * 2 * noise); }
const mix = (x: Float32Array, at: number, s: Float32Array) => { const o = secs(at); s.forEach((v, i) => { if (o + i < x.length) x[o + i] += v; }); return x; };

const tone = (hz: number | ((t: number) => number), sec: number, amp = 0.1) => {
  let phase = 0;
  return Float32Array.from({ length: secs(sec) }, (_, i) => { const f = typeof hz === "number" ? hz : hz(i / RATE); phase += 2 * Math.PI * f / RATE; return amp * Math.sin(phase); });
};
/** A hand clap: a white noise burst that dies in a few milliseconds. */
const clap = (amp = 0.7, seed = 3) => { const r = rng(seed); return Float32Array.from({ length: secs(0.06) }, (_, i) => r() * 2 * amp * Math.exp(-i / (RATE * 0.008))); };
/** A desk thump: low and decaying, no high end. */
const thump = (amp = 0.7) => Float32Array.from({ length: secs(0.06) }, (_, i) => amp * Math.sin(2 * Math.PI * 80 * i / RATE) * Math.exp(-i / (RATE * 0.012)));
/** A voiced syllable: harmonics of 160 Hz with a formant near 700 Hz. */
const syllable = (sec: number, amp = 0.25) => Float32Array.from({ length: secs(sec) }, (_, i) => {
  const t = i / RATE, env = Math.sin(Math.PI * i / secs(sec)) ** 0.5; let v = 0;
  for (let h = 1; h <= 25; h++) { const f = 160 * h; v += Math.sin(2 * Math.PI * f * t) / (1 + ((f - 700) / 500) ** 2); }
  return amp * env * v / 3;
});

function run(x: Float32Array, setup?: (d: SoundDetector) => void, chunk = 2048) {
  const heard: Sound[] = [];
  const d = new SoundDetector(RATE, s => heard.push(s));
  setup?.(d);
  for (let i = 0; i < x.length; i += chunk) d.push(x.subarray(i, i + chunk));
  return heard;
}

describe("analyze", () => {
  const frame = (x: Float32Array) => analyze(x.subarray(0, FRAME), RATE);
  it("finds the dominant pitch of a tone", () => {
    const f = frame(tone(2000, 0.05));
    expect(Math.abs(f.dominantHz - 2000)).toBeLessThan(50);
    expect(f.peakShare).toBeGreaterThan(0.9);
  });
  it("noise has no dominant peak and plenty of high end", () => {
    const f = frame(room(0.05, 0.3));
    expect(f.peakShare).toBeLessThan(0.3);
    expect(f.highShare).toBeGreaterThan(0.5);
  });
  it("measures level", () => { expect(frame(tone(1000, 0.05, 0.1)).rms).toBeCloseTo(0.0707, 2); });
  it("silence doesn't divide by zero", () => {
    const f = analyze(new Float32Array(FRAME), RATE);
    expect(f.rms).toBe(0); expect(f.peakShare).toBe(0); expect(f.highShare).toBe(0);
  });
});

describe("whistle", () => {
  it("hears a steady 2 kHz whistle of 400 ms", () => { expect(run(mix(room(1), 0.2, tone(2000, 0.4)))).toEqual(["whistle"]); });
  it.each([1100, 1500, 3000, 3800])("hears %d Hz", hz => { expect(run(mix(room(1), 0.2, tone(hz, 0.4)))).toEqual(["whistle"]); });
  it("hears a whistle that slides up", () => { expect(run(mix(room(1), 0.2, tone(t => 1500 + 2500 * t, 0.5)))).toEqual(["whistle"]); });
  it("a long whistle counts once", () => { expect(run(mix(room(3), 0.2, tone(2000, 2.2)))).toEqual(["whistle"]); });
  it("two separate whistles count twice", () => { expect(run(mix(mix(room(3), 0.2, tone(2000, 0.4)), 1.8, tone(2200, 0.4)))).toEqual(["whistle", "whistle"]); });
  it("is heard while a key is held, you whistle as you play", () => { expect(run(mix(room(1), 0.2, tone(2000, 0.4)), d => d.keyDown())).toEqual(["whistle"]); });

  it("ignores a 150 ms chirp", () => { expect(run(mix(room(1), 0.2, tone(2000, 0.15)))).toEqual([]); });
  it("ignores a 500 Hz hum", () => { expect(run(mix(room(1), 0.1, tone(500, 0.7)))).toEqual([]); });
  it("ignores a 6 kHz beep", () => { expect(run(mix(room(1), 0.1, tone(6000, 0.7)))).toEqual([]); });
  it("ignores steady hiss", () => { expect(run(room(2, 0.2))).toEqual([]); });
  it("ignores talking", () => {
    const x = room(3);
    for (let t = 0.1; t < 2.7; t += 0.31) mix(x, t, syllable(0.24));
    expect(run(x)).toEqual([]);
  });
  it("ignores a whistle too faint for the calibrated room", () => {
    const x = mix(room(1), 0.2, tone(2000, 0.4, 0.004));
    expect(run(x, d => d.setCalibration(calibrationFrom(Array(100).fill(0.01))))).toEqual([]);
  });
  it("ignores a pitch that jumps around", () => {
    const x = room(1);
    for (let i = 0; i < 10; i++) mix(x, 0.1 + i * 0.05, tone(i % 2 ? 1200 : 3400, 0.05));
    expect(run(x)).toEqual([]);
  });
});

describe("double clap", () => {
  const two = (gap: number, a = clap(), b = clap(0.7, 9)) => mix(mix(room(2), 0.3, a), 0.3 + gap, b);
  it.each([0.16, 0.3, 0.45, 0.58])("hears two claps %f s apart", gap => { expect(run(two(gap))).toEqual(["clap"]); });
  it("works with a quieter clap after a loud one", () => { expect(run(two(0.3, clap(0.8), clap(0.3, 5)))).toEqual(["clap"]); });
  it("three quick claps count once", () => {
    expect(run(mix(two(0.3), 0.9, clap(0.7, 11)))).toEqual(["clap"]);
  });
  it("two double claps a while apart count twice", () => {
    const x = mix(mix(mix(mix(room(4), 0.3, clap()), 0.6, clap(0.7, 4)), 2.5, clap(0.7, 5)), 2.8, clap(0.7, 6));
    expect(run(x)).toEqual(["clap", "clap"]);
  });

  it("ignores one clap", () => { expect(run(mix(room(2), 0.3, clap()))).toEqual([]); });
  it("ignores two claps 100 ms apart", () => { expect(run(two(0.1))).toEqual([]); });
  it("ignores two claps 800 ms apart", () => { expect(run(two(0.8))).toEqual([]); });
  it("ignores two desk thumps, they have no high end", () => { expect(run(two(0.3, thump(), thump()))).toEqual([]); });
  it("ignores two short beeps, they aren't broadband", () => { expect(run(two(0.3, tone(1000, 0.03, 0.5), tone(1000, 0.03, 0.5)))).toEqual([]); });
  it("ignores claps under the calibrated threshold", () => {
    expect(run(two(0.3, clap(0.1), clap(0.1, 5)), d => d.setCalibration(calibrationFrom(Array(100).fill(0.05))))).toEqual([]);
  });
  it("ignores a loud sustained noise, which isn't a spike", () => {
    const r = rng(2);
    const burst = (sec: number) => Float32Array.from({ length: secs(sec) }, () => r() * 1.2);
    expect(run(mix(mix(room(2), 0.3, burst(0.2)), 0.65, burst(0.2)))).toEqual([]);
  });
  it("ignores talking, even loud talking", () => {
    const x = room(4);
    for (let t = 0.1; t < 3.6; t += 0.3) mix(x, t, syllable(0.2, 0.5));
    expect(run(x)).toEqual([]);
  });
});

describe("keypress transients", () => {
  const keys = (d: SoundDetector, x: Float32Array) => { for (let i = 0; i < x.length; i += 2048) d.push(x.subarray(i, i + 2048)); };
  const tap = (amp = 0.5) => clap(amp);
  it("two key clicks with no key tracking would look like a clap", () => {
    expect(run(mix(mix(room(1.5), 0.3, tap()), 0.6, tap()))).toEqual(["clap"]);
  });
  it("are ignored while a key is held", () => {
    const x = mix(mix(room(1.5), 0.3, tap()), 0.6, tap());
    expect(run(x, d => d.keyDown())).toEqual([]);
  });
  it("the key's release click is ignored too", () => {
    const heard: Sound[] = [];
    const d = new SoundDetector(RATE, s => heard.push(s));
    keys(d, room(0.3)); d.keyDown(); keys(d, mix(room(0.3), 0.1, tap()));
    d.keyUp(); keys(d, mix(room(0.3), 0.02, tap())); // release click lands right after keyup
    keys(d, mix(room(0.3), 0.05, tap())); // one real spike later: must not pair with the release click
    expect(heard).toEqual([]);
  });
  it("claps work again once the keys are up", () => {
    const heard: Sound[] = [];
    const d = new SoundDetector(RATE, s => heard.push(s));
    d.keyDown(); keys(d, room(0.2)); d.keyUp(); keys(d, room(0.3));
    keys(d, mix(mix(room(1), 0.1, clap()), 0.4, clap(0.7, 8)));
    expect(heard).toEqual(["clap"]);
  });
  it("two keys down, one up, still counts as held", () => {
    const x = mix(mix(room(1.5), 0.3, tap()), 0.6, tap());
    expect(run(x, d => { d.keyDown(); d.keyDown(); d.keyUp(); })).toEqual([]);
  });
});

describe("pause and calibration", () => {
  it("hears nothing while paused, like during push to talk", () => {
    expect(run(mix(room(1), 0.2, tone(2000, 0.4)), d => d.setPaused(true))).toEqual([]);
  });
  it("calibrationFrom uses the median, so a cough doesn't deafen it", () => {
    const quiet = Array(200).fill(0.002);
    expect(calibrationFrom([...quiet, 0.9, 0.9, 0.9])).toEqual(calibrationFrom(quiet));
  });
  it("louder rooms raise both thresholds, and quiet rooms keep a floor", () => {
    const loud = calibrationFrom(Array(100).fill(0.02)), quiet = calibrationFrom(Array(100).fill(0));
    expect(loud.clapRms).toBeGreaterThan(quiet.clapRms);
    expect(loud.whistleRms).toBeGreaterThan(quiet.whistleRms);
    expect(quiet.clapRms).toBeGreaterThan(0);
    expect(quiet).toEqual(DEFAULT_CALIBRATION);
  });
  it("2 s calibration listens, stays silent, then reports", () => {
    const heard: Sound[] = [];
    const d = new SoundDetector(RATE, s => heard.push(s));
    let done = 0;
    d.calibrate(2000, () => { done++; });
    const noisy = mix(room(1.9, 0.02), 0.5, tone(2000, 0.5, 0.2));
    d.push(noisy);
    expect(done).toBe(0);
    d.push(room(0.2, 0.02));
    expect(done).toBe(1);
    expect(heard).toEqual([]);
    expect(d.calibration.clapRms).toBeGreaterThan(DEFAULT_CALIBRATION.clapRms);
  });
});
