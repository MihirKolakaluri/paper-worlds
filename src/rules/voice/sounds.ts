// Whistle and double clap from raw samples. Transcribe can't hear non-speech, so this runs locally. Pure: time comes
// from counting samples, so synthetic signals in the tests behave exactly like a live mic.
export type Sound = "whistle" | "clap";
export type Calibration = { whistleRms: number; clapRms: number };
export type Features = { rms: number; dominantHz: number; peakShare: number; highShare: number };

export const FRAME = 1024;
const HOP = 512;

const WHISTLE_MIN_HZ = 1000, WHISTLE_MAX_HZ = 4000;
const WHISTLE_MS = 250;
const WHISTLE_PEAK_SHARE = 0.6; // most of the energy sits in one narrow peak
const WHISTLE_DRIFT = 0.15; // a real whistle slides, it doesn't jump
const WHISTLE_GAP_MS = 40; // one or two bad frames don't break a whistle
const WHISTLE_REARM_MS = 150, WHISTLE_COOLDOWN_MS = 600;

const CLAP_MIN_GAP_MS = 150, CLAP_MAX_GAP_MS = 600;
const CLAP_JUMP = 3; // a spike stands this far above the recent level
const CLAP_PEAK_WINDOW_MS = 30;
const CLAP_DECAY_MS = 90, CLAP_DECAY_TO = 0.7; // and is mostly gone this soon, unlike a shout or a word
const CLAP_LOCKOUT_MS = 120, CLAP_COOLDOWN_MS = 700;
const CLAP_MAX_PEAK_SHARE = 0.7, CLAP_MIN_HIGH_SHARE = 0.1; // set from real claps in a real room: 8 of them heard, 1 false alarm in 3 minutes of talk
const KEY_QUIET_MS = 150; // a key's release click comes just after keyup

const SLOW_FOLLOW = 0.05;
const MIN_WHISTLE_RMS = 0.003, MIN_CLAP_RMS = 0.02, MAX_CLAP_RMS = 0.3;

export const DEFAULT_CALIBRATION: Calibration = { whistleRms: MIN_WHISTLE_RMS, clapRms: MIN_CLAP_RMS };

/** Median, so one cough during the 2 s doesn't deafen the detector. */
export function calibrationFrom(rms: number[]): Calibration {
  const sorted = [...rms].sort((a, b) => a - b), mid = sorted[sorted.length >> 1] ?? 0;
  return { whistleRms: Math.max(MIN_WHISTLE_RMS, mid * 3), clapRms: Math.min(MAX_CLAP_RMS, Math.max(MIN_CLAP_RMS, mid * 8)) };
}

const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** Radix 2 FFT in place. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}

const re = new Float32Array(FRAME), im = new Float32Array(FRAME);

export function analyze(frame: Float32Array, rate: number): Features {
  let sq = 0;
  for (let i = 0; i < FRAME; i++) { sq += frame[i] * frame[i]; re[i] = frame[i] * hann[i]; im[i] = 0; }
  fft(re, im);
  const binHz = rate / FRAME, lo = Math.ceil(100 / binHz), hi = Math.ceil(1000 / binHz);
  let total = 0, high = 0, best = lo, bestP = -1;
  for (let k = lo; k < FRAME / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    re[k] = p; total += p;
    if (k >= hi) high += p;
    if (p > bestP) { bestP = p; best = k; }
  }
  let peak = 0;
  for (let k = Math.max(lo, best - 3); k <= Math.min(FRAME / 2 - 1, best + 3); k++) peak += re[k];
  return { rms: Math.sqrt(sq / FRAME), dominantHz: best * binHz, peakShare: total ? peak / total : 0, highShare: total ? high / total : 0 };
}

export class SoundDetector {
  calibration = DEFAULT_CALIBRATION;
  private buf = new Float32Array(FRAME);
  private fill = 0;
  private now = 0; // ms of audio heard so far
  private paused = false;
  private cal: { until: number; rms: number[]; done: () => void } | null = null;
  // whistle
  private toneStart = -1; private lastTone = -1e9; private lastHz = 0; private armed = true; private toneReadyAt = 0;
  // clap
  private slow = 0; private spike: { t: number; peak: number; broad: boolean } | null = null;
  private lockedUntil = 0; private first: number | null = null; private clapReadyAt = 0;
  private keysHeld = 0; private keysQuietAt = 0;

  constructor(private readonly rate: number, private readonly onSound: (s: Sound) => void) {}

  setCalibration(c: Calibration) { this.calibration = c; }
  setPaused(p: boolean) { this.paused = p; this.clear(); }
  keyDown() { this.keysHeld++; }
  keyUp() { this.keysHeld = Math.max(0, this.keysHeld - 1); this.keysQuietAt = this.now + KEY_QUIET_MS; }

  /** Listen to the room for `ms`, set the thresholds from it, then call done. Detection is off meanwhile. */
  calibrate(ms: number, done: () => void) { this.clear(); this.cal = { until: this.now + ms, rms: [], done }; }

  push(samples: Float32Array) {
    let at = 0;
    while (at < samples.length) {
      const n = Math.min(FRAME - this.fill, samples.length - at);
      this.buf.set(samples.subarray(at, at + n), this.fill);
      this.fill += n; at += n;
      if (this.fill === FRAME) {
        this.frame(analyze(this.buf, this.rate));
        this.buf.copyWithin(0, HOP); this.fill = FRAME - HOP;
        this.now += (HOP / this.rate) * 1000;
      }
    }
  }

  private clear() { this.toneStart = -1; this.spike = null; this.first = null; this.armed = true; }

  private frame(f: Features) {
    if (this.cal) {
      this.cal.rms.push(f.rms);
      if (this.now >= this.cal.until) { const c = this.cal; this.cal = null; this.calibration = calibrationFrom(c.rms); this.slow = 0; c.done(); }
      return;
    }
    if (this.paused) return;
    this.whistle(f);
    this.clap(f);
  }

  private whistle(f: Features) {
    const t = this.now;
    const tone = f.rms >= this.calibration.whistleRms && f.peakShare >= WHISTLE_PEAK_SHARE && f.dominantHz >= WHISTLE_MIN_HZ && f.dominantHz <= WHISTLE_MAX_HZ;
    if (!tone) {
      if (t - this.lastTone > WHISTLE_GAP_MS) this.toneStart = -1;
      if (t - this.lastTone > WHISTLE_REARM_MS) this.armed = true;
      return;
    }
    if (this.toneStart < 0 || Math.abs(f.dominantHz - this.lastHz) > this.lastHz * WHISTLE_DRIFT) this.toneStart = t;
    this.lastTone = t; this.lastHz = f.dominantHz;
    if (this.armed && t >= this.toneReadyAt && t - this.toneStart >= WHISTLE_MS) {
      this.armed = false; this.toneReadyAt = t + WHISTLE_COOLDOWN_MS;
      this.onSound("whistle");
    }
  }

  private clap(f: Features) {
    const t = this.now;
    if (this.keysHeld > 0 || t < this.keysQuietAt) { this.spike = null; this.first = null; this.follow(f); return; }
    const broad = f.peakShare <= CLAP_MAX_PEAK_SHARE && f.highShare >= CLAP_MIN_HIGH_SHARE;
    if (this.spike) {
      const s = this.spike;
      if (t - s.t <= CLAP_PEAK_WINDOW_MS && f.rms > s.peak) { s.peak = f.rms; s.broad = broad; }
      if (t - s.t < CLAP_DECAY_MS) return;
      this.spike = null;
      if (s.broad && f.rms < s.peak * CLAP_DECAY_TO) this.spikeConfirmed(s.t);
      else this.slow = Math.max(this.slow, f.rms); // sustained noise: treat it as the new normal
      return;
    }
    if (t >= this.lockedUntil && f.rms >= this.calibration.clapRms && f.rms >= this.slow * CLAP_JUMP) {
      this.spike = { t, peak: f.rms, broad };
      this.lockedUntil = t + CLAP_LOCKOUT_MS;
      return;
    }
    this.follow(f);
  }

  private follow(f: Features) { this.slow += (f.rms - this.slow) * SLOW_FOLLOW; }

  private spikeConfirmed(t: number) {
    if (t < this.clapReadyAt) return;
    if (this.first === null) { this.first = t; return; }
    const gap = t - this.first;
    if (gap < CLAP_MIN_GAP_MS) return;
    if (gap > CLAP_MAX_GAP_MS) { this.first = t; return; }
    this.first = null; this.clapReadyAt = t + CLAP_COOLDOWN_MS;
    this.onSound("clap");
  }
}
