// Ties tracker, calibration and the game hooks together. No DOM here, so the whole path runs in tests.
import type { Hooks } from "@/game/hooks";
import type { Img } from "@/level/ink";
import type { Box } from "@/lib/sam";
import type { Mover } from "@/schema/mover";
import { boxToLevel, noteShape, toLevel, type Homography } from "./calibrate";
import { reconcile, type Anchor, type Applied } from "./reanchor";
import { signature } from "./signatures";
import { Tracker, type Track } from "./tracker";

const MAX_NOTES = 6;
const DRIFT_PX = 24; // SAM vs tracker on the same frame, in processing px
export type SessionHooks = Pick<Hooks, "addMover" | "removeMover" | "setMoverTarget" | "setMoverAlpha" | "setRide">;
type Note = { mover: Mover; present: boolean; alpha: number; w: number; h: number };

export class MoverSession {
  readonly tracker = new Tracker();
  private notes = new Map<string, Note>();
  private H: Homography | null = null;
  private nextId = 1;

  constructor(private hooks: SessionHooks, private levelW: number, private levelH: number, private tile: number) {}

  get count() { return this.notes.size; }
  setCalibration(H: Homography) { this.H = H; }

  /** Boxes in the frame's own pixels. Frame must be the one the boxes came from. */
  addNotes(boxes: Box[], frame: Img): { added: number; warnings: string[] } {
    const H = this.H;
    if (!H) return { added: 0, warnings: ["Set the paper corners first."] };
    const fresh = boxes.filter(b => !this.tracker.all.some(t => t.x >= b.x1 && t.x <= b.x2 && t.y >= b.y1 && t.y <= b.y2));
    const warnings = new Set<string>();
    let added = 0;
    for (const box of fresh) {
      if (this.notes.size >= MAX_NOTES) { warnings.add(`${MAX_NOTES} notes is the most I can follow.`); break; }
      const sig = signature(frame, box, boxes.filter(b => b !== box));
      if (!sig.ok) { warnings.add(sig.reason); continue; }
      if (sig.warning) warnings.add(sig.warning);
      const r = boxToLevel(H, box), id = `note-${this.nextId++}`, shape = noteShape(r, this.tile);
      const w = shape[0].length * this.tile, h = shape.length * this.tile;
      const mover: Mover = { id, color: sig.color, hsv: sig.hsv, shape, pos: this.clamp(r.x, r.y, w, h) };
      this.notes.set(id, { mover, present: true, alpha: 1, w, h });
      this.tracker.add(id, sig.hsv, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, (box.x2 - box.x1) * (box.y2 - box.y1));
      this.hooks.addMover(mover);
      if (this.notes.size === 1) this.hooks.setRide(id); // the first note is the controller
      added++;
    }
    return { added, warnings: [...warnings] };
  }

  /** One camera frame in, hook calls out. Returns how long the worst note has been missing. */
  step(data: Uint8ClampedArray, w: number, h: number, now: number): { lostMs: number; tracks: readonly Track[] } {
    const tracks = this.tracker.process(data, w, h, now);
    let lostMs = 0;
    for (const t of tracks) {
      lostMs = Math.max(lostMs, t.lostMs);
      this.sync(t);
    }
    return { lostMs, tracks };
  }

  private sync(t: Track) {
    const n = this.notes.get(t.id), H = this.H;
    if (!n || !H) return;
    if (t.state !== "tracking") return; // a covered note leaves the plank where it was, so the player isn't dropped
    if (t.state === "tracking") {
      const [x, y] = toLevel(H, t.x, t.y);
      n.mover.pos = this.clamp(x, y, n.w, n.h);
      if (!n.present) { this.hooks.addMover(n.mover); n.present = true; n.alpha = 1; this.hooks.setMoverAlpha(t.id, 1); }
      this.hooks.setMoverTarget(t.id, n.mover.pos.x, n.mover.pos.y);
    }
  }

  private clamp(x: number, y: number, w: number, h: number) {
    return { x: Math.max(w / 2, Math.min(this.levelW - w / 2, x)), y: Math.max(h / 2, Math.min(this.levelH - h / 2, y)) };
  }

  /** Where every note is right now. Take this at the moment a frame is captured for SAM. */
  anchors(): Anchor[] {
    return this.tracker.all.map(t => ({ id: t.id, x: t.x, y: t.y, sig: t.sig, lost: t.state !== "tracking" }));
  }

  /** SAM's boxes for a captured frame, in that frame's pixels. */
  applyBoxes(boxes: Box[], cap: { frame: Img; anchors: Anchor[] }, now: number): Applied {
    const matches = reconcile(boxes, cap.anchors, cap.frame);
    let changed = false, found = 0;
    for (const m of matches) {
      const was = cap.anchors.find(a => a.id === m.id)!, cur = this.tracker.get(m.id);
      if (!cur) continue; // removed while SAM was thinking
      if (cur.state !== "tracking") {
        // A note that is still lost: trust SAM's spot and learn its colour again from that same frame,
        // as a lost note under a new shadow or light may no longer fit the old range.
        // A colour that also fits the rest of the picture means SAM boxed the desk, not the note. Learning it would
        // lock the tracker onto the desk for good, so wait for a better answer.
        const sig = signature(cap.frame, m.box);
        if (!sig.ok || sig.warning) continue;
        this.tracker.setSignature(m.id, sig.hsv);
        this.tracker.reanchor(m.id, m.x, m.y, now);
        changed = true;
        found++;
      } else if (Math.hypot(m.x - was.x, m.y - was.y) > DRIFT_PX && !was.lost) {
        // The tracker was off when the frame was taken, so correct by that error, not to the old spot.
        this.tracker.reanchor(m.id, cur.x + m.x - was.x, cur.y + m.y - was.y, now);
        changed = true;
      }
    }
    return { changed, found }; // found = lost notes rescued, which is what the lost back-off needs
  }

  removeLast() {
    const id = [...this.notes.keys()].pop();
    if (id) this.drop(id);
  }

  clear() { [...this.notes.keys()].forEach(id => this.drop(id)); }

  private drop(id: string) {
    this.notes.delete(id);
    this.tracker.remove(id);
    this.hooks.removeMover(id);
    this.hooks.setRide([...this.notes.keys()][0] ?? null);
  }
}
