// The kid's own drawing, cleaned up into game art. The photo is never shown in play: we keep only the ink
// that belongs to the level (near platforms, lava, the figure and the flag), redraw it in crisp ink on clean
// paper, and cut the stick figure and flag out so they can move. Browser only (canvas).
import type { Level } from "@/schema/level";
import { masks, type Img } from "@/level/ink";

export const PAPER = "#fbf7ee";
export const INK: [number, number, number] = [31, 36, 51];
export const LAVA: [number, number, number] = [229, 56, 59];

export type Art = {
  paper: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  lava: HTMLCanvasElement;
  glow: HTMLCanvasElement; // 2 px per tile, blurred; draw it scaled by tileSize / 2
  hero: HTMLCanvasElement;
  flag: HTMLCanvasElement;
  flagAt: { x: number; y: number }; // world px of the flag canvas's top left
  lavaTops: [number, number][]; // world px points on top of lava, for embers
};

const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

/** Thicken a 0/1 mask by r px and soften the edge: returns alpha 0..255. */
export function inkAlpha(m: Uint8Array, w: number, h: number, r = 1): Uint8ClampedArray {
  const fat = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) fat[ny * w + nx] = 1;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; s += fat[ny * w + nx]; n++;
    }
    out[y * w + x] = Math.round((s / n) * 255);
  }
  return out;
}

/** Keep whole strokes, not pixels: a connected piece of ink stays if any of it belongs to the level, and goes
 *  if it touches the photo's edge (a pen, a shadow, the desk). Small gaps in faint pencil are bridged. */
export function keepStrokes(m: Uint8Array, w: number, h: number, belongs: (x: number, y: number) => boolean, special: (x: number, y: number) => boolean = () => false, minPx = 12): Uint8Array {
  const label = new Int32Array(w * h).fill(-1), out = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || label[s] >= 0) continue;
    const st = [s], px: number[] = []; label[s] = s;
    let ok = false, edge = false, inObj = false;
    while (st.length) {
      const i = st.pop()!, x = i % w, y = (i / w) | 0; px.push(i);
      if (x < 6 || y < 6 || x >= w - 6 || y >= h - 6) edge = true;
      if (!ok && belongs(x, y)) ok = true;
      if (!inObj && special(x, y)) inObj = true;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (m[j] && label[j] < 0) { label[j] = s; st.push(j); }
      }
    }
    // a flag drawn right at the top of the page touches the edge too: keep small strokes in the flag/figure area
    if (ok && (!edge || (inObj && px.length < 1500)) && px.length >= minPx) for (const i of px) out[i] = 1;
  }
  return out;
}

function paint(c: HTMLCanvasElement, alpha: Uint8ClampedArray, rgb: [number, number, number], x0 = 0, y0 = 0, sw = c.width) {
  const g = c.getContext("2d")!, id = g.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const a = alpha[(y + y0) * sw + x + x0]; if (!a) continue;
    const i = 4 * (y * c.width + x); id.data[i] = rgb[0]; id.data[i + 1] = rgb[1]; id.data[i + 2] = rgb[2]; id.data[i + 3] = a;
  }
  g.putImageData(id, 0, 0);
}

/** Crop a box (world px) out of an alpha map into its own canvas, trimmed to the ink. */
function cutOut(alpha: Uint8ClampedArray, w: number, h: number, box: [number, number, number, number], rgb: [number, number, number]) {
  let [x0, y0, x1, y1] = box.map(Math.round) as [number, number, number, number];
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  let a = 1e9, b = -1, c = 1e9, d = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alpha[y * w + x] > 40) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
  if (b < 0) return null;
  const cv = canvas(b - a + 1, d - c + 1);
  paint(cv, alpha, rgb, a, c, w);
  for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) alpha[y * w + x] = 0; // remove it from the page
  return { cv, x: a, y: c };
}

function paperCanvas(W: number, H: number) {
  const c = canvas(W, H), g = c.getContext("2d")!;
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (W * H) / 90; i++) { g.fillStyle = `rgba(120,100,70,${0.03 + rnd() * 0.04})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(90,70,40,0.10)");
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return c;
}

/** A hand-drawn-looking stroke for platform tiles that have no ink (the fixture level, a widened ledge). */
function wobblyLine(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, seed: number) {
  g.beginPath();
  for (let x = x0; x <= x1; x += 3) { const yy = y + Math.sin(x * 0.09 + seed) * 1.2 + Math.sin(x * 0.023 + seed * 3) * 1.6; if (x === x0) g.moveTo(x, yy); else g.lineTo(x, yy); }
  g.stroke();
}

function stickFigure(h: number) {
  const w = Math.round(h * 0.6), c = canvas(w + 6, h + 6), g = c.getContext("2d")!;
  g.strokeStyle = `rgb(${INK})`; g.lineWidth = Math.max(2.5, h / 14); g.lineCap = "round"; g.lineJoin = "round";
  const cx = c.width / 2, hr = h * 0.15, top = 3;
  g.beginPath(); g.arc(cx, top + hr, hr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, top + 2 * hr); g.lineTo(cx, top + h * 0.62);
  g.moveTo(cx - w * 0.42, top + h * 0.42); g.lineTo(cx, top + h * 0.36); g.lineTo(cx + w * 0.42, top + h * 0.42);
  g.moveTo(cx - w * 0.32, top + h); g.lineTo(cx, top + h * 0.62); g.lineTo(cx + w * 0.32, top + h); g.stroke();
  return c;
}

function drawnFlag(w: number, h: number) {
  const c = canvas(w + 6, h + 6), g = c.getContext("2d")!;
  g.strokeStyle = g.fillStyle = `rgb(${INK})`; g.lineWidth = 3; g.lineCap = "round";
  g.beginPath(); g.moveTo(4, 3); g.lineTo(4, h + 3); g.stroke();
  g.beginPath(); g.moveTo(5, 4); g.lineTo(w + 2, h * 0.22 + 4); g.lineTo(5, h * 0.45 + 4); g.closePath(); g.fill();
  return c;
}

export function buildArt(level: Level, photo: HTMLImageElement | HTMLCanvasElement | null): Art {
  const T = level.tileSize, cols = level.width, rows = level.height, W = cols * T, H = rows * T;
  const near = (x: number, y: number, grid: boolean[][], reach: number) => {
    const c = (x / T) | 0, r = (y / T) | 0;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) if (grid[r + dr]?.[c + dc]) return true;
    return false;
  };
  const sp = level.spawn, gl = level.goal;
  const spBox: [number, number, number, number] = sp.w && sp.h
    ? [(sp.x - sp.w / 2 - 1) * T, (sp.y - 1) * T, (sp.x + sp.w / 2 + 1) * T, (sp.y + sp.h) * T] : [0, 0, 0, 0];
  // the flag blob is often just the pole: reach right and up for the cloth, stop above the ground line
  let ground = gl.y + gl.h; // the line the flag stands on: stop the cutout just above it
  for (let r = Math.max(0, Math.floor(gl.y)); r < rows; r++) if ([-1, 0, 1].some(d => level.solid[r]?.[Math.floor(gl.x) + d])) { ground = r; break; }
  const glBox: [number, number, number, number] = [(gl.x - 2) * T, (gl.y - 2) * T, (gl.x + gl.w + 5) * T, ground * T - 4];
  const inBox = (x: number, y: number, b: number[]) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3];

  let darkA: Uint8ClampedArray = new Uint8ClampedArray(W * H), redA: Uint8ClampedArray = new Uint8ClampedArray(W * H);
  const lavaTops: [number, number][] = [];
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) if (level.lava[r][c] && !level.lava[r - 1][c]) lavaTops.push([c * T + T / 2, r * T]);

  if (photo) {
    const src = canvas(W, H), g = src.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(photo, 0, 0);
    const img: Img = g.getImageData(0, 0, W, H);
    const m = masks(img, 4, 0.9);
    const obj = (x: number, y: number) => inBox(x, y, spBox) || inBox(x, y, glBox);
    const keepD = keepStrokes(m.dark, W, H, (x, y) => obj(x, y) || near(x, y, level.solid, 1), obj);
    const keepR = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (m.red[i] && near(i % W, (i / W) | 0, level.lava, 1)) keepR[i] = 1;
    darkA = inkAlpha(keepD, W, H, 2);
    redA = inkAlpha(keepR, W, H, 1);
  }

  // hero and flag come off the page
  const heroCut = photo && sp.w ? cutOut(darkA, W, H, spBox, INK) : null;
  const flagCut = photo ? cutOut(darkA, W, H, glBox, INK) : null;

  const ink = canvas(W, H);
  paint(ink, darkA, INK);
  // platform tiles with no ink nearby get a drawn stroke (the fixture level, the widened start ledge)
  const g = ink.getContext("2d")!;
  g.strokeStyle = `rgb(${INK})`; g.lineWidth = 3.5; g.lineCap = "round";
  for (let r = 0; r < rows; r++) {
    let c0 = -1;
    for (let c = 0; c <= cols; c++) {
      let bare = false;
      if (c < cols && level.solid[r][c]) {
        bare = true;
        for (let y = Math.max(0, (r - 2) * T); y < Math.min(H, (r + 3) * T) && bare; y++) for (let x = c * T; x < (c + 1) * T; x++) if (darkA[y * W + x] > 60) { bare = false; break; }
      }
      if (bare && c0 < 0) c0 = c;
      if (!bare && c0 >= 0) { wobblyLine(g, c0 * T, c * T, r * T + 3, r * 1.7 + c0); c0 = -1; }
    }
  }

  const lava = canvas(W, H);
  paint(lava, redA, LAVA);
  if (!photo) { // fixture: scribble the lava in like a red marker
    const lg = lava.getContext("2d")!; lg.strokeStyle = `rgb(${LAVA})`; lg.lineWidth = 2.5; lg.lineCap = "round";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (level.lava[r][c]) {
      lg.beginPath(); lg.moveTo(c * T, (r + 1) * T); lg.lineTo((c + 1) * T + 2, r * T); lg.stroke();
    }
  }
  // soft heat glow: lava at 2 px per tile, box blurred 3 times (no canvas filter, so it works in Safari)
  const K = 2, gw = cols * K, gh = rows * K;
  let v = new Float32Array(gw * gh);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (level.lava[r][c]) for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) v[(r * K + y) * gw + c * K + x] = 1;
  for (let pass = 0; pass < 6; pass++) {
    const o2 = new Float32Array(gw * gh), R = 3, horiz = pass % 2 === 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let sum = 0;
      for (let d = -R; d <= R; d++) { const xx = horiz ? x + d : x, yy = horiz ? y : y + d; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) sum += v[yy * gw + xx]; }
      o2[y * gw + x] = sum / (2 * R + 1);
    }
    v = o2;
  }
  const glow = canvas(gw, gh), gg = glow.getContext("2d")!, gd = gg.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) { gd.data[4 * i] = gd.data[4 * i + 1] = gd.data[4 * i + 2] = 255; gd.data[4 * i + 3] = Math.min(255, v[i] * 400); }
  gg.putImageData(gd, 0, 0);

  const figH = Math.max(24, (sp.h ?? 6) * T);
  return {
    paper: paperCanvas(W, H), ink, lava, glow,
    hero: heroCut?.cv ?? stickFigure(figH),
    flag: flagCut?.cv ?? drawnFlag(gl.w * T, gl.h * T),
    flagAt: flagCut ? { x: flagCut.x, y: flagCut.y } : { x: gl.x * T - 4, y: gl.y * T - 3 },
    lavaTops,
  };
}
