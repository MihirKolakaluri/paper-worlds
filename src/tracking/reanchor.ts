// SAM keeps the colour tracker honest: on a timer, and whenever a note is lost, it looks at the latest frame.
// Nothing here blocks the frame loop: tick() is a few comparisons and the call runs on its own.
// SAM answers in 1 to 2 s, so its boxes describe the past. Everything is judged against where the
// tracker thought the notes were when that frame was taken (Capture.anchors), never against now.
import type { Img } from "@/level/ink";
import type { Box } from "@/lib/sam";
import { matchShare, type Hsv } from "./signatures";

export const BASE_GAP_MS = 2000;
const MAX_GAP_MS = 30_000;
const QUIET_PER_STEP = 20; // calls with nothing to fix before the gap doubles
const LOST_AFTER_MS = 300;
const LOST_GAP_MS = 1500;
const ERROR_PAUSE_MS = 10_000;
const CLOSED_PAUSE_MS = 300_000; // kill switch or daily cap: no point asking again soon
const COLOUR_SHARE = 0.4;
const MAX_FALLBACK_DIST = 120; // processing px

export type Anchor = { id: string; x: number; y: number; sig: Hsv; lost: boolean };
export type Match = { id: string; x: number; y: number; byColor: boolean; box: Box };
export type Capture = { image: string; w: number; h: number; frame: Img; anchors: Anchor[] };
export type FindResult = { ok: true; boxes: Box[] } | { ok: false; status: number; retryAfter?: number; error?: string };
export type Applied = { changed: boolean; found: number };

/** Boxes and anchors share the frame's coordinates. Colour decides first, then position, and only lost notes get the position fallback. */
export function reconcile(boxes: Box[], anchors: Anchor[], frame: Img): Match[] {
  const centre = (b: Box) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
  const free = new Set(boxes), out: Match[] = [], done = new Set<string>();
  const pairs = anchors.flatMap(a => boxes.map(b => {
    const c = centre(b);
    return { a, b, c, d: Math.hypot(c.x - a.x, c.y - a.y), share: matchShare(frame, b, a.sig) };
  }));
  const take = (p: (typeof pairs)[number], byColor: boolean) => {
    if (done.has(p.a.id) || !free.has(p.b)) return;
    done.add(p.a.id); free.delete(p.b);
    out.push({ id: p.a.id, x: p.c.x, y: p.c.y, byColor, box: p.b });
  };
  const nearest = [...pairs].sort((p, q) => p.d - q.d);
  nearest.filter(p => p.share >= COLOUR_SHARE).forEach(p => take(p, true));
  nearest.filter(p => p.a.lost && p.d <= MAX_FALLBACK_DIST).forEach(p => take(p, false));
  return out;
}

/** Client side call to the route. Never throws for an HTTP error, so callers can read the status. */
export async function postFrame(image: string, w: number, h: number, signal?: AbortSignal): Promise<FindResult> {
  const res = await fetch("/api/find-objects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, w, h }), signal });
  const body = await res.json().catch(() => ({})) as { boxes?: Box[]; error?: string };
  if (res.ok && body.boxes) return { ok: true, boxes: body.boxes };
  return { ok: false, status: res.status, retryAfter: Number(res.headers.get("retry-after")) || undefined, error: body.error };
}

type Deps = {
  capture(): Promise<Capture>;
  find(image: string, w: number, h: number): Promise<FindResult>;
  apply(boxes: Box[], cap: Capture): Applied;
  onFire?(): void;
};

export class ReanchorLoop {
  gap = BASE_GAP_MS;
  pausedUntil = 0;
  calls = 0;
  private quiet = 0;
  private lostGap = LOST_GAP_MS;
  private lastFire = -Infinity;
  private busy = false;
  private stopped = false;
  private clock = 0;

  constructor(private d: Deps) {}

  /** Next timer gap: doubles after a long enough quiet streak, back to 2 s the moment something needed fixing. */
  static nextGap(gap: number, quiet: number, changed: boolean) {
    if (changed) return { gap: BASE_GAP_MS, quiet: 0 };
    return quiet + 1 >= QUIET_PER_STEP ? { gap: Math.min(gap * 2, MAX_GAP_MS), quiet: 0 } : { gap, quiet: quiet + 1 };
  }

  stop() { this.stopped = true; }

  /** Call once per frame. lostMs is the longest any note has been missing. */
  tick(now: number, lostMs: number) {
    this.clock = now;
    if (this.busy || this.stopped || now < this.pausedUntil) return;
    const lost = lostMs > LOST_AFTER_MS;
    if (now - this.lastFire < (lost ? this.lostGap : this.gap)) return;
    this.lastFire = now;
    this.busy = true;
    this.calls++;
    this.d.onFire?.();
    void this.run(lost);
  }

  private async run(lost: boolean) {
    try {
      const cap = await this.d.capture();
      const r = await this.d.find(cap.image, cap.w, cap.h);
      if (this.stopped) return;
      if (!r.ok) { this.pause(r); return; }
      const { changed, found } = this.d.apply(r.boxes, cap);
      ({ gap: this.gap, quiet: this.quiet } = ReanchorLoop.nextGap(this.gap, this.quiet, changed));
      // A note that stays gone (taken off the table, say) shouldn't cost a call every 1.5 s for ever.
      this.lostGap = lost && !found ? Math.min(this.lostGap * 2, MAX_GAP_MS) : LOST_GAP_MS;
    } catch {
      this.pausedUntil = this.clock + ERROR_PAUSE_MS; // offline or no frame: the local tracker carries on
    } finally {
      this.busy = false;
    }
  }

  private pause(r: { status: number; retryAfter?: number }) {
    const ms = r.status === 429 ? (r.retryAfter ?? 60) * 1000 : r.status === 503 ? CLOSED_PAUSE_MS : ERROR_PAUSE_MS;
    this.pausedUntil = this.clock + ms;
  }
}

/** Calls in the first hour for notes that behave. Checked against the server budget in the guard tests. */
export function callsInFirstHour() {
  let calls = 0, t = 0, gap = BASE_GAP_MS, quiet = 0;
  while (t < 3_600_000) { calls++; t += gap; ({ gap, quiet } = ReanchorLoop.nextGap(gap, quiet, false)); }
  return calls;
}
