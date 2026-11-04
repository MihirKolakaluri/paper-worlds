// The browser side of tracking: camera stream, the 320 px frame loop, the preview, and SAM calls.
// All the decisions live in session.ts and reanchor.ts, which are tested without a browser.
import type { Img, Pt } from "@/level/ink";
import type { Box } from "@/lib/sam";
import { calibrate, fullFrameCorners } from "./calibrate";
import { openCamera } from "./camera";
import { postFrame, ReanchorLoop, type Capture } from "./reanchor";
import { MoverSession, type SessionHooks } from "./session";
import { PROC_W, type Track } from "./tracker";

const SNAP_W = 640; // frames for SAM. Measured at this size: boxes back in 1.1 s
const FLASH_MS = 600;

export type Stats = { fps: number; ms: number; calls: number; gapMs: number; flash: boolean; paused: boolean; notes: number; lost: number };
type Level = { w: number; h: number; tile: number };

export class Rig {
  readonly session: MoverSession;
  corners: Pt[] = [];
  /** The preview canvas, set by the panel. */
  view: HTMLCanvasElement | null = null;

  private video = document.createElement("video");
  private proc = document.createElement("canvas");
  private snap = document.createElement("canvas");
  private pctx = this.proc.getContext("2d", { willReadFrequently: true })!;
  private stream: MediaStream | null = null;
  private loop: ReanchorLoop;
  private raf = 0;
  private closed = false;
  private lastT = -1;
  private tracks: readonly Track[] = [];
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;
  private msAvg = 0;
  private flashUntil = 0;

  constructor(hooks: SessionHooks, private level: Level, private onStats: (s: Stats) => void, private onCameraLost: () => void) {
    this.session = new MoverSession(hooks, level.w, level.h, level.tile);
    this.video.playsInline = true;
    this.video.muted = true;
    this.loop = new ReanchorLoop({
      capture: () => this.capture(),
      find: (image, w, h) => postFrame(image, w, h, AbortSignal.timeout(12_000)),
      apply: (boxes, cap) => this.session.applyBoxes(this.toProc(boxes, cap), cap, performance.now()),
      onFire: () => { this.flashUntil = performance.now() + FLASH_MS; },
    });
  }

  async open(deviceId: string) {
    this.stopStream();
    const stream = await openCamera(deviceId);
    if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (!this.closed) this.onCameraLost(); });
    this.video.srcObject = stream;
    await this.video.play();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.loop.stop();
    this.session.clear();
    this.stopStream();
  }

  private stopStream() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  /** Adds a clicked corner. Returns an error, or null. Calibrates on the 4th. */
  addCorner(x: number, y: number): string | null {
    this.corners.push([x * this.proc.width, y * this.proc.height]);
    if (this.corners.length < 4) return null;
    const c = calibrate(this.corners, this.level.w, this.level.h);
    if (!c.ok) { this.corners = []; return c.error; }
    this.session.setCalibration(c.H);
    return null;
  }

  useWholeFrame() {
    this.corners = fullFrameCorners(this.proc.width, this.proc.height);
    const c = calibrate(this.corners, this.level.w, this.level.h);
    if (c.ok) this.session.setCalibration(c.H);
  }

  async findNotes(): Promise<{ added: number; warnings: string[]; error?: string }> {
    try {
      let cap = await this.capture();
      let r = await postFrame(cap.image, cap.w, cap.h, AbortSignal.timeout(20_000));
      if (r.ok && !r.boxes.length) { // SAM can miss a note on one frame and see it on the next, so look once more
        cap = await this.capture();
        r = await postFrame(cap.image, cap.w, cap.h, AbortSignal.timeout(20_000));
      }
      if (!r.ok) return { added: 0, warnings: [], error: r.error ?? "The AI didn't answer. Wait a moment and try again." };
      if (!r.boxes.length) return { added: 0, warnings: [], error: "I don't see a sticky note. Put a bright blue or green one on the paper and try again." };
      const res = this.session.addNotes(this.toProc(r.boxes, cap), cap.frame);
      if (!res.added && !res.warnings.length) return { ...res, error: "I don't see any new notes." };
      return res;
    } catch {
      return { added: 0, warnings: [], error: "Couldn't reach the AI. Check your connection and try again." };
    }
  }

  private toProc(boxes: Box[], cap: Pick<Capture, "w" | "frame">): Box[] {
    const k = cap.frame.width / cap.w;
    return boxes.map(b => ({ x1: b.x1 * k, y1: b.y1 * k, x2: b.x2 * k, y2: b.y2 * k }));
  }

  /** The frame for SAM and the same frame at tracker size, plus where the tracker thinks the notes are right now. */
  private async capture(): Promise<Capture> {
    const v = this.video, w = Math.min(SNAP_W, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
    if (!w || !h) throw new Error("no frame yet");
    this.snap.width = w; this.snap.height = h;
    this.snap.getContext("2d")!.drawImage(v, 0, 0, w, h);
    this.pctx.drawImage(v, 0, 0, this.proc.width, this.proc.height);
    const d = this.pctx.getImageData(0, 0, this.proc.width, this.proc.height);
    const frame: Img = { data: d.data, width: d.width, height: d.height }, anchors = this.session.anchors();
    const blob = await new Promise<Blob | null>(r => this.snap.toBlob(r, "image/jpeg", 0.8)); // encodes off the frame loop
    if (!blob) throw new Error("no jpeg");
    const image = await new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result as string); f.onerror = no; f.readAsDataURL(blob); });
    return { image, w, h, frame, anchors };
  }

  private frame = (now: number) => {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frame);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastT) return; // no new camera frame yet
    this.lastT = v.currentTime;
    const W = PROC_W, H = Math.round(PROC_W * v.videoHeight / v.videoWidth);
    if (this.proc.width !== W || this.proc.height !== H) { this.proc.width = W; this.proc.height = H; }
    this.pctx.drawImage(v, 0, 0, W, H);

    const t0 = performance.now();
    if (this.session.count) {
      const { lostMs, tracks } = this.session.step(this.pctx.getImageData(0, 0, W, H).data, W, H, now);
      this.tracks = tracks;
      this.loop.tick(now, lostMs);
    } else this.tracks = [];
    this.msAvg = this.msAvg * 0.9 + (performance.now() - t0) * 0.1;

    if (this.view) this.draw(this.view, W, H);
    this.frames++;
    if (now - this.fpsAt >= 250) {
      this.fps = this.frames * 1000 / (now - this.fpsAt);
      this.frames = 0; this.fpsAt = now;
      this.onStats({ fps: this.fps, ms: this.msAvg, calls: this.loop.calls, gapMs: this.loop.gap, flash: now < this.flashUntil, paused: now < this.loop.pausedUntil, notes: this.session.count, lost: this.tracks.filter(t => t.state !== "tracking").length });
    }
  };

  private draw(c: HTMLCanvasElement, W: number, H: number) {
    const cw = 480, ch = Math.round(cw * H / W), k = cw / W;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext("2d")!;
    g.drawImage(this.video, 0, 0, cw, ch);
    g.lineWidth = 2;
    if (this.corners.length) {
      g.strokeStyle = "#ffd60a"; g.fillStyle = "#ffd60a"; g.font = "bold 14px system-ui";
      g.beginPath();
      this.corners.forEach(([x, y], i) => { if (i) g.lineTo(x * k, y * k); else g.moveTo(x * k, y * k); });
      if (this.corners.length === 4) g.closePath();
      g.stroke();
      this.corners.forEach(([x, y], i) => { g.beginPath(); g.arc(x * k, y * k, 5, 0, 7); g.fill(); g.fillText(String(i + 1), x * k + 8, y * k + 16); });
    }
    for (const t of this.tracks) {
      g.strokeStyle = t.state === "tracking" ? "#fff" : "#ff453a";
      g.beginPath(); g.arc(t.x * k, t.y * k, 9, 0, 7); g.stroke();
    }
  }
}
