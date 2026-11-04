// Push to talk audio. Transcribe takes WAV only (mono 16-bit PCM at 16 or 24 kHz), and MediaRecorder can't make
// one, so the WAV is built by hand. Everything except openMic is pure and tested.
export const TALK_RATE = 16000;
export const MAX_TALK_SEC = 15;
export const MIN_TALK_SEC = 0.3;
/** Browser voice cleanup treats a whistle as noise and a clap as an echo, so it all stays off. */
export const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };

/** Averages each output sample's span of input, which also filters out what 16 kHz can't hold. */
export function downsample(x: Float32Array, from: number, to = TALK_RATE): Float32Array {
  if (from === to) return x;
  const ratio = from / to, out = new Float32Array(Math.round(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(x.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += x[j];
    out[i] = sum / (b - a);
  }
  return out;
}

export function encodeWav(x: Float32Array, rate = TALK_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, x.length * 2, true);
  x.forEach((s, i) => { const c = Math.max(-1, Math.min(1, s)); v.setInt16(44 + i * 2, c < 0 ? c * 32768 : Math.round(c * 32767), true); });
  return buf;
}

/** One held press of the talk button. */
export class Take {
  private chunks: Float32Array[] = [];
  private count = 0;
  private readonly max: number;
  constructor(private readonly rate: number, maxSec = MAX_TALK_SEC) { this.max = Math.round(rate * maxSec); }
  /** Returns true once the cap is reached. */
  push(frame: Float32Array): boolean {
    const room = this.max - this.count;
    if (room > 0) { const part = frame.slice(0, room); this.chunks.push(part); this.count += part.length; }
    return this.count >= this.max;
  }
  get seconds() { return this.count / this.rate; }
  wav(): ArrayBuffer {
    const all = new Float32Array(this.count);
    let at = 0;
    for (const c of this.chunks) { all.set(c, at); at += c.length; }
    return encodeWav(downsample(all, this.rate));
  }
}

export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The mic is blocked. Allow it in your browser's address bar, or type your rule instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No mic found. Type your rule instead.";
  if (name === "NotReadableError") return "Another app is using the mic. Close it, or type your rule instead.";
  return "The mic didn't start. Type your rule instead.";
}

export type Mic = { rate: number; close(): void };

/** Opens the mic and calls onFrame with raw samples. The buffer is reused, so copy what you keep. */
export async function openMic(onFrame: (x: Float32Array) => void): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("no mic", "NotFoundError");
  // start audio inside the click: after the permission wait it no longer counts as a gesture and Safari would stay suspended
  const ctx = new AudioContext();
  void ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).catch(e => { void ctx.close(); throw e; });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but needs no worklet file and runs everywhere; it has to reach the output to run, so through a muted gain
  const tap = ctx.createScriptProcessor(2048, 1, 1), mute = ctx.createGain();
  mute.gain.value = 0;
  tap.onaudioprocess = e => onFrame(e.inputBuffer.getChannelData(0));
  source.connect(tap); tap.connect(mute); mute.connect(ctx.destination);
  return {
    rate: ctx.sampleRate,
    close() { tap.onaudioprocess = null; source.disconnect(); tap.disconnect(); stream.getTracks().forEach(t => t.stop()); void ctx.close(); },
  };
}
