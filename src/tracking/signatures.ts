// Turns a note's box on a camera frame into an HSV range the tracker can follow.
// Always sampled from the same frame SAM saw, so exposure and white balance match.
import type { Img } from "@/level/ink";
import type { Box } from "@/lib/sam";
import type { Mover } from "@/schema/mover";

export type Hsv = Mover["hsv"];
export type Signature = { ok: true; hsv: Hsv; color: string; warning?: string } | { ok: false; reason: string };

const SAT_FLOOR = 0.25; // below this a note is too close to paper to tell apart (same gate as the catch test)
const SKIN_HUE = [8, 45], SKIN_MAX_SAT = 0.7; // hands and wood: SAM sometimes calls them sticky notes
const BG_WARN = 0.03; // share of everything outside the notes that also matches

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}

/** hMin > hMax means the range wraps through 0 (reds). */
export function hsvMatch(h: number, s: number, v: number, g: Hsv) {
  return s >= g.sMin && v >= g.vMin && (g.hMin <= g.hMax ? h >= g.hMin && h <= g.hMax : h >= g.hMin || h <= g.hMax);
}

const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const inBox = (x: number, y: number, b: Box) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
const grow = (b: Box, k: number): Box => { const dx = (b.x2 - b.x1) * k, dy = (b.y2 - b.y1) * k; return { x1: b.x1 - dx, y1: b.y1 - dy, x2: b.x2 + dx, y2: b.y2 + dy }; };

/** Share of the middle of a box that fits a signature. Used to tell which note a box is. */
export function matchShare(f: Img, b: Box, g: Hsv) {
  const m = grow(b, -0.2);
  let n = 0, hit = 0;
  const step = Math.max(1, Math.floor((m.x2 - m.x1) / 24));
  for (let y = Math.ceil(m.y1); y <= m.y2; y += step) for (let x = Math.ceil(m.x1); x <= m.x2; x += step) {
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) continue;
    const i = 4 * (y * f.width + x), [h, s, v] = rgbToHsv(f.data[i], f.data[i + 1], f.data[i + 2]);
    n++; if (hsvMatch(h, s, v, g)) hit++;
  }
  return n ? hit / n : 0;
}

export function signature(f: Img, box: Box, others: Box[] = []): Signature {
  const m = grow(box, -0.2); // central 60%: skips the paper a loose box catches, the shadow and the curled edge
  const hs: number[] = [], ss: number[] = [], vs: number[] = [], rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const step = Math.max(1, Math.floor((m.x2 - m.x1) / 48));
  for (let y = Math.ceil(m.y1); y <= m.y2; y += step) for (let x = Math.ceil(m.x1); x <= m.x2; x += step) {
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) continue;
    const i = 4 * (y * f.width + x), r = f.data[i], g = f.data[i + 1], b = f.data[i + 2], [h, s, v] = rgbToHsv(r, g, b);
    hs.push(h); ss.push(s); vs.push(v); rs.push(r); gs.push(g); bs.push(b);
  }
  if (hs.length < 4) return { ok: false, reason: "That note is too small to see. Move the camera closer." };
  const S = median(ss), V = median(vs);
  if (S < SAT_FLOOR) return { ok: false, reason: "That note is too pale to follow. Bright blue or green works best." };
  if (V < 0.2) return { ok: false, reason: "That note is too dark to follow. Add more light." };

  // Circular mean, then a tolerance from how much of the note strays from it.
  let cx = 0, cy = 0;
  hs.forEach((h, i) => { if (ss[i] >= SAT_FLOOR * 0.6) { cx += Math.cos(h * Math.PI / 180); cy += Math.sin(h * Math.PI / 180); } });
  const hue = (Math.atan2(cy, cx) * 180 / Math.PI + 360) % 360;
  if (hue >= SKIN_HUE[0] && hue <= SKIN_HUE[1] && S < SKIN_MAX_SAT) return { ok: false, reason: "That looks like a hand or the desk. Use a blue or green note." };
  const gaps = hs.filter((_, i) => ss[i] >= SAT_FLOOR * 0.6).map(h => hueGap(h, hue)).sort((a, b) => a - b);
  const tol = Math.max(12, Math.min(26, (gaps[Math.floor(gaps.length * 0.9)] ?? 0) + 6));
  const hsv: Hsv = { hMin: (hue - tol + 360) % 360, hMax: (hue + tol) % 360, sMin: Math.max(0.2, S * 0.55), vMin: Math.max(0.15, V * 0.4) };

  // How much of the rest of the picture would also pass as this note?
  const skip = [grow(box, 0.1), ...others.map(o => grow(o, 0.1))];
  const bgStep = Math.max(2, Math.floor(f.width / 160));
  let n = 0, hit = 0;
  for (let y = 0; y < f.height; y += bgStep) for (let x = 0; x < f.width; x += bgStep) {
    if (skip.some(b => inBox(x, y, b))) continue;
    const i = 4 * (y * f.width + x), [h, s, v] = rgbToHsv(f.data[i], f.data[i + 1], f.data[i + 2]);
    n++; if (hsvMatch(h, s, v, hsv)) hit++;
  }
  const hex = [rs, gs, bs].map(c => Math.round(median(c)).toString(16).padStart(2, "0")).join("");
  const out: Signature = { ok: true, hsv, color: `#${hex}` };
  if (n && hit / n > BG_WARN) out.warning = "This note's colour matches the background, so it may jump around. Try a blue or green note on a plain surface.";
  return out;
}
