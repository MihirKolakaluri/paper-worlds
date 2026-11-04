// Local colour tracker, ported from the catch test (30 fps, ~5 ms a frame on a real iPhone feed). No network here.
// Per frame: HSV once for the frame, then per note: match, connected blobs, pick one, smooth its centroid.
import type { Hsv } from "./signatures";
import { hsvMatch, rgbToHsv } from "./signatures";

export const PROC_W = 320; // frames arrive at this width
const STEP = 2; // read every 2nd pixel each way
const HOLD_MS = 500, FADE_MS = 500;
const MAX_GROW = 4;
const SNAP_AFTER_MS = 100; // back from a gap this long: jump to the note, don't smooth across it

/** One-euro filter: smooths hard when still, gets out of the way when moving fast. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 2, private beta = 0.15, private dCutoff = 5) {}
  private static alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  /** t is in seconds. */
  next(v: number, t: number) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(t - this.t, 1e-3);
    this.t = t;
    const a = OneEuro.alpha(this.dCutoff, dt);
    this.dx = a * ((v - this.x) / dt) + (1 - a) * this.dx;
    const k = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = k * v + (1 - k) * this.x;
    return this.x;
  }
}

export type Blob = { x: number; y: number; n: number };

/** 8-connected blobs in a gw x gh mask. Clears the mask as it goes. Coordinates are in mask cells. */
export function findBlobs(mask: Uint8Array, gw: number, gh: number, minN: number, stack: Int32Array): Blob[] {
  const out: Blob[] = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!mask[s]) continue;
    let top = 0, n = 0, sx = 0, sy = 0;
    stack[top++] = s; mask[s] = 0;
    while (top) {
      const p = stack[--top], x = p % gw, y = (p / gw) | 0;
      n++; sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx;
        if (mask[q]) { mask[q] = 0; stack[top++] = q; }
      }
    }
    if (n >= minN) out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
}

export type TrackState = "tracking" | "held" | "fading" | "gone";
export type Track = { id: string; x: number; y: number; state: TrackState; alpha: number; lostMs: number };
type Entry = Track & { sig: Hsv; minN: number; maxN: number; fx: OneEuro; fy: OneEuro; lostAt: number | null; seenAt: number };

export class Tracker {
  private notes: Entry[] = [];
  private h = new Float32Array(0);
  private s = new Float32Array(0);
  private v = new Float32Array(0);
  private mask = new Uint8Array(0);
  private stack = new Int32Array(0);

  /** areaPx is the note's size on the processing frame; it sets how small a blob still counts. */
  add(id: string, sig: Hsv, x: number, y: number, areaPx: number) {
    this.notes.push({ id, x, y, state: "tracking", alpha: 1, lostMs: 0, sig, minN: Math.max(6, (areaPx / (STEP * STEP)) * 0.15), maxN: (areaPx / (STEP * STEP)) * MAX_GROW, fx: new OneEuro(), fy: new OneEuro(), lostAt: null, seenAt: -Infinity });
  }
  remove(id: string) { this.notes = this.notes.filter(n => n.id !== id); }
  get(id: string): Track | undefined { return this.notes.find(n => n.id === id); }
  get all(): readonly (Track & { sig: Hsv })[] { return this.notes; }
  setSignature(id: string, sig: Hsv) { const n = this.notes.find(e => e.id === id); if (n) n.sig = sig; }

  /** Put a note back at a known spot (from SAM). It counts as seen right now. */
  reanchor(id: string, x: number, y: number, now: number) {
    const n = this.notes.find(e => e.id === id);
    if (!n) return;
    n.x = x; n.y = y; n.state = "tracking"; n.alpha = 1; n.lostMs = 0; n.lostAt = null; n.seenAt = now;
    n.fx.reset(); n.fy.reset();
  }

  process(data: Uint8ClampedArray, w: number, h: number, now: number): Track[] {
    const gw = Math.floor(w / STEP), gh = Math.floor(h / STEP), N = gw * gh;
    if (this.mask.length !== N) { this.h = new Float32Array(N); this.s = new Float32Array(N); this.v = new Float32Array(N); this.mask = new Uint8Array(N); this.stack = new Int32Array(N); }
    if (!this.notes.length) return [];
    for (let gy = 0, c = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++, c++) {
      const i = (gy * STEP * w + gx * STEP) * 4, [hh, ss, vv] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      this.h[c] = hh; this.s[c] = ss; this.v[c] = vv;
    }
    const taken: Blob[] = [];
    for (const n of this.notes) {
      for (let c = 0; c < N; c++) this.mask[c] = hsvMatch(this.h[c], this.s[c], this.v[c], n.sig) ? 1 : 0;
      const blobs = findBlobs(this.mask, gw, gh, n.minN, this.stack).map(b => ({ x: b.x * STEP, y: b.y * STEP, n: b.n }));
      // Big and close wins. A blob another note already claimed is off the table.
      let best: Blob | null = null, score = 0;
      for (const b of blobs) {
        if (b.n > n.maxN) continue; // far bigger than the note: a desk or a wall, not a note lifted nearer the camera
        if (taken.some(t => Math.abs(t.x - b.x) < 1 && Math.abs(t.y - b.y) < 1)) continue;
        const sc = b.n / (1 + (Math.hypot(b.x - n.x, b.y - n.y) / 60) ** 2);
        if (sc > score) { score = sc; best = b; }
      }
      if (best) { taken.push(best); this.seen(n, best, now); } else this.missing(n, now);
    }
    return this.notes;
  }

  private seen(n: Entry, b: Blob, now: number) {
    if (now - n.seenAt > SNAP_AFTER_MS) { n.fx.reset(); n.fy.reset(); }
    n.x = n.fx.next(b.x, now / 1000); n.y = n.fy.next(b.y, now / 1000);
    n.seenAt = now; n.lostAt = null; n.state = "tracking"; n.alpha = 1; n.lostMs = 0;
  }

  private missing(n: Entry, now: number) {
    n.lostAt ??= Number.isFinite(n.seenAt) ? n.seenAt : now;
    n.lostMs = now - n.lostAt;
    if (n.lostMs < HOLD_MS) { n.state = "held"; n.alpha = 1; }
    else if (n.lostMs < HOLD_MS + FADE_MS) { n.state = "fading"; n.alpha = 1 - (n.lostMs - HOLD_MS) / FADE_MS; }
    else { n.state = "gone"; n.alpha = 0; }
  }
}
