// Pixel side of the level reader. Runs in the browser on canvas ImageData (and in tests on plain arrays).
// Flow: photo -> paperQuad (auto corners, user can drag) -> warp (flat page) -> cropToInk
//       -> Spark marks (server) -> buildLevel: pixels inside each Spark box give the exact platform line.
import type { Level } from "@/schema/level";
import { checkReach } from "@/game/reach";
import { physicsFor } from "@/game/physics";

export const T = 8; // tile size in px on the flat page
export type Img = { data: Uint8ClampedArray; width: number; height: number };
export type Pt = [number, number];
export type Mark = { kind: "platform" | "lava" | "goal" | "spawn"; box: [number, number, number, number] };

const isRed = (r: number, g: number, b: number) => r > 90 && r - g > 40 && r - b > 25;

// ---------- 1. find the paper ----------
export function paperQuad(img: Img, STD = 9): [Pt, Pt, Pt, Pt] {
  const { data, width: w, height: h } = img, S = 8;
  const gw = Math.floor(w / S), gh = Math.floor(h / S), g0 = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let pc = 0, rc = 0, sum = 0, sq = 0;
    for (let y = gy * S; y < gy * S + S; y++) for (let x = gx * S; x < gx * S + S; x++) {
      const i = 4 * (y * w + x), r = data[i], gg = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (isRed(r, gg, b)) { rc++; continue; }
      if (mx > 140 && mx - mn < 0.16 * mx) { pc++; const L = 0.299 * r + 0.587 * gg + 0.114 * b; sum += L; sq += L * L; }
    }
    const sd = pc > 1 ? Math.sqrt(Math.max(0, sq / pc - (sum / pc) ** 2)) : 99;
    g0[gy * gw + gx] = pc + rc >= 0.6 * S * S && sd < STD ? 1 : 0;
  }
  const morph = (src: Uint8Array, r: number, erode: boolean) => {
    const o = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let v = erode ? 1 : 0;
      outer: for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx, cell = yy >= 0 && xx >= 0 && yy < gh && xx < gw ? src[yy * gw + xx] : 0;
        if (erode && !cell) { v = 0; break outer; }
        if (!erode && cell) { v = 1; break outer; }
      }
      o[y * gw + x] = v;
    }
    return o;
  };
  const E = 2, g = morph(morph(morph(g0, 2, false), 2, true), E, true);
  const lab = new Int32Array(gw * gh).fill(-1);
  let best = -1, bestN = 0, id = 0;
  for (let s = 0; s < gw * gh; s++) {
    if (!g[s] || lab[s] >= 0) continue;
    const st = [s]; lab[s] = id; let n = 0;
    while (st.length) {
      const p = st.pop()!; n++; const x = p % gw, y = (p / gw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx; if (g[q] && lab[q] < 0) { lab[q] = id; st.push(q); }
      }
    }
    if (n > bestN) { bestN = n; best = id; } id++;
  }
  if (best < 0 || bestN < 50) { const m = Math.min(w, h) * 0.08; return [[m, m], [w - m, m], [w - m, h - m], [m, h - m]]; }
  let tl: Pt = [0, 0], tr: Pt = [0, 0], br: Pt = [0, 0], bl: Pt = [0, 0], a = 1e9, b2 = -1e9, c = -1e9, d = -1e9;
  for (let p = 0; p < gw * gh; p++) {
    if (lab[p] !== best) continue;
    const x = (p % gw) * S + S / 2, y = ((p / gw) | 0) * S + S / 2;
    if (x + y < a) { a = x + y; tl = [x, y]; }
    if (x - y > b2) { b2 = x - y; tr = [x, y]; }
    if (x + y > c) { c = x + y; br = [x, y]; }
    if (y - x > d) { d = y - x; bl = [x, y]; }
  }
  const o = E * S, cl = (v: number, m: number) => Math.max(0, Math.min(m, v));
  return [[cl(tl[0] - o, w), cl(tl[1] - o, h)], [cl(tr[0] + o, w), cl(tr[1] - o, h)], [cl(br[0] + o, w), cl(br[1] + o, h)], [cl(bl[0] - o, w), cl(bl[1] + o, h)]];
}

// ---------- 2. flatten ----------
function solve(A: number[][], b: number[]) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function homography(src: Pt[], dst: Pt[]) {
  const A: number[][] = [], B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  return [...solve(A, B), 1];
}
export function warp(img: Img, quad: Pt[], W: number, H: number): Img {
  const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const { data, width: w, height: h } = img, out = new Uint8ClampedArray(W * H * 4);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const z = Hm[6] * u + Hm[7] * v + Hm[8];
    const x = (Hm[0] * u + Hm[1] * v + Hm[2]) / z, y = (Hm[3] * u + Hm[4] * v + Hm[5]) / z;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0)), o = 4 * (v * W + u);
    for (let k = 0; k < 3; k++) {
      const p = (yy: number, xx: number) => data[4 * (yy * w + xx) + k];
      out[o + k] = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy;
    }
    out[o + 3] = 255;
  }
  return { data: out, width: W, height: H };
}
/** Flatten the page inside quad to US letter at 100 px per inch, in the page's own orientation. */
export function flatten(img: Img, q: Pt[]): Img {
  const dist = (p: Pt, r: Pt) => Math.hypot(p[0] - r[0], p[1] - r[1]);
  const across = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, down = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const k = 1100 / Math.max(across, down); // long side 1100 px, keep the paper's own shape
  return warp(img, q, Math.round(across * k), Math.round(down * k));
}

// ---------- 3. ink masks ----------
export type Masks = { dark: Uint8Array; red: Uint8Array; w: number; h: number };
export function masks(img: Img, margin = 14, k = 0.8): Masks {
  const { data, width: w, height: h } = img, N = w * h;
  const L = new Float64Array(N), I = new Float64Array((w + 1) * (h + 1));
  for (let i = 0; i < N; i++) L[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const R = 20, dark = new Uint8Array(N), red = new Uint8Array(N);
  for (let y = margin; y < h - margin; y++) for (let x = margin; x < w - margin; x++) {
    const i = y * w + x, r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
    if (isRed(r, g, b)) { red[i] = 1; continue; }
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    if (L[i] < mean * k) dark[i] = 1;
  }
  return { dark, red, w, h };
}

/** Crop the flat page to the drawn area plus a margin, so the level is the drawing and not blank paper. */
export function cropToInk(img: Img, margin = 32): Img {
  const m = masks(img);
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = y * img.width + x;
    if (m.dark[i] || m.red[i]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) return img;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin * 3); // extra headroom above the top platform
  x1 = Math.min(img.width, x1 + margin); y1 = Math.min(img.height, y1 + margin);
  const W = x1 - x0, H = y1 - y0, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) out.set(img.data.subarray(4 * ((y + y0) * img.width + x0), 4 * ((y + y0) * img.width + x1)), 4 * y * W);
  return { data: out, width: W, height: H };
}

// ---------- 4. tiles ----------
// grid codes: 0 empty, 1 solid, 2 lava
export type TileMap = { grid: Uint8Array; cols: number; rows: number };
export function tiles(m: Masks): TileMap {
  const cols = Math.ceil(m.w / T), rows = Math.ceil(m.h / T), dk = new Uint16Array(cols * rows), rd = new Uint16Array(cols * rows);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const t = ((y / T) | 0) * cols + ((x / T) | 0), i = y * m.w + x;
    dk[t] += m.dark[i]; rd[t] += m.red[i];
  }
  const grid = new Uint8Array(cols * rows);
  for (let t = 0; t < grid.length; t++) grid[t] = rd[t] >= 10 ? 2 : dk[t] >= 4 ? 1 : 0;
  const at = (c: number, r: number) => grid[r * cols + c];
  for (let r = 0; r < rows; r++) { let last = -99; for (let c = 0; c < cols; c++) if (at(c, r) === 2) { if (c - last > 1 && c - last <= 4) for (let k = last + 1; k < c; k++) grid[r * cols + k] = 2; last = c; } }
  for (let c = 0; c < cols; c++) { let last = -99; for (let r = 0; r < rows; r++) if (at(c, r) === 2) { if (r - last > 1 && r - last <= 3) for (let k = last + 1; k < r; k++) grid[k * cols + c] = 2; last = r; } }
  return { grid, cols, rows };
}

export type Blob = { c0: number; c1: number; r0: number; r1: number; n: number; used?: boolean };
/** Compact upright ink blobs (stick figure, flag): solid tiles in vertical runs of 3+. */
export function blobs(tm: TileMap): Blob[] {
  const { grid, cols, rows } = tm, thick = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (grid[r * cols + c] !== 1) { r++; continue; }
      let e = r; while (e < rows && grid[e * cols + c] === 1) e++;
      if (e - r >= 3) for (let k = r; k < e; k++) thick[k * cols + c] = 1;
      r = e;
    }
  }
  const seen = new Uint8Array(cols * rows), out: Blob[] = [];
  for (let s = 0; s < thick.length; s++) {
    if (!thick[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1; let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1, n = 0;
    while (st.length) {
      const p = st.pop()!, c = p % cols, r = (p / cols) | 0; n++;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nc = c + dx, nr = r + dy; if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const q = nr * cols + nc; if (thick[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    out.push({ c0, c1, r0, r1, n });
  }
  return out;
}

export type Placed = { snapped: true; c0: number; c1: number; r0: number; r1: number } | { snapped: false; c: number; r: number };
/** Snap Spark's spawn and goal to the nearest upright blob. Returns tile rectangles to cut out of the terrain. */
export function placeObjects(tm: TileMap, marks: Mark[], sx: number, sy: number) {
  const bl = blobs(tm), res: Partial<Record<"spawn" | "goal", Placed>> = {};
  for (const kind of ["spawn", "goal"] as const) {
    const m = marks.find(k => k.kind === kind); if (!m) continue;
    const cx = (m.box[0] + m.box[2]) / 2 * sx / T, cy = (m.box[1] + m.box[3]) / 2 * sy / T;
    let best: Blob | null = null, bd = 1e9;
    for (const b of bl) { if (b.used) continue; const d = Math.hypot((b.c0 + b.c1) / 2 - cx, (b.r0 + b.r1) / 2 - cy); if (d < bd) { bd = d; best = b; } }
    if (!best || bd > 20) { res[kind] = { snapped: false, c: Math.round(cx), r: Math.round(cy) }; continue; }
    best.used = true;
    res[kind] = { snapped: true, c0: best.c0, c1: best.c1, r0: best.r0, r1: best.r1 };
  }
  return res;
}

/** Spark's box says roughly where each platform is; ink inside it says exactly where. Wavy lines become straight. */
export function fitPlatforms(loose: Masks, marks: Mark[], sx: number, sy: number, cols: number, rows: number, cut: (x: number, y: number) => boolean) {
  const grid = new Uint8Array(cols * rows), warnings: string[] = [];
  const put = (c: number, r: number) => { if (c >= 0 && r >= 0 && c < cols && r < rows) grid[r * cols + c] = 1; };
  for (const mk of marks.filter(k => k.kind === "platform")) {
    const bx0 = Math.max(0, Math.floor(mk.box[0] * sx - 16)), bx1 = Math.min(loose.w, Math.ceil(mk.box[2] * sx + 16));
    const by0 = Math.max(0, Math.floor(mk.box[1] * sy - 28)), by1 = Math.min(loose.h, Math.ceil(mk.box[3] * sy + 28));
    const colY = new Map<number, number[]>(); let n = 0;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const i = y * loose.w + x; if (!loose.dark[i] || cut(x, y)) continue;
      const c = (x / T) | 0; if (!colY.has(c)) colY.set(c, []); colY.get(c)!.push(y); n++;
    }
    const cs = [...colY.keys()].filter(c => colY.get(c)!.length >= 2).sort((a, b) => a - b);
    if (n < 15 || cs.length < 3) { // no ink found: trust Spark's box
      warnings.push("A platform was hard to see, so I used its rough position.");
      const r = Math.round((mk.box[1] + mk.box[3]) / 2 * sy / T);
      for (let c = Math.floor(mk.box[0] * sx / T); c <= Math.floor(mk.box[2] * sx / T); c++) put(c, r);
      continue;
    }
    const pts = cs.map(c => { const ys = colY.get(c)!.sort((a, b) => a - b); return [c, ys[ys.length >> 1] / T] as const; });
    const k = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / k, my = pts.reduce((s, p) => s + p[1], 0) / k;
    const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    let slope = sxx ? sxy / sxx : 0;
    if (Math.abs(slope * (cs[cs.length - 1] - cs[0])) < 1.5) slope = 0; // nearly flat: make it perfectly flat
    for (let c = cs[0]; c <= cs[cs.length - 1]; c++) put(c, Math.floor(my + slope * (c - mx)));
  }
  return { grid, warnings };
}

/** The whole pixel side: flat cropped page + Spark marks (in markW x markH pixels) -> Level. */
export function buildLevel(img: Img, marks: Mark[], markW: number, markH: number, image?: string): { level: Level; error?: string } {
  const sx = img.width / markW, sy = img.height / markH;
  const tm = tiles(masks(img, 14, 0.8));
  const obj = placeObjects(tm, marks, sx, sy);
  const cut = (x: number, y: number) => Object.values(obj).some(o => o?.snapped && x >= (o.c0 - 1) * T && x < (o.c1 + 2) * T && y >= (o.r0 - 1) * T && y < o.r1 * T);
  const { grid, warnings } = fitPlatforms(masks(img, 14, 0.88), marks, sx, sy, tm.cols, tm.rows, cut);
  for (let t = 0; t < grid.length; t++) if (tm.grid[t] === 2) grid[t] = 2;
  const { cols, rows } = tm;
  const solid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r * cols + c] === 1));
  const lava = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r * cols + c] === 2));

  const sp = obj.spawn, gl = obj.goal;
  if (sp && !sp.snapped) warnings.push("I wasn't sure where the stick figure was, so I guessed.");
  if (gl && !gl.snapped) warnings.push("I wasn't sure where the flag was, so I guessed.");
  const spawn = !sp ? { x: 3, y: 2 } : sp.snapped ? { x: (sp.c0 + sp.c1 + 1) / 2, y: sp.r0, w: sp.c1 - sp.c0 + 1, h: sp.r1 - sp.r0 + 1 } : { x: sp.c, y: sp.r };
  const goal = !gl ? { x: cols - 4, y: 2, w: 3, h: 4 } : gl.snapped
    ? { x: gl.c0, y: gl.r0, w: gl.c1 - gl.c0 + 1, h: gl.r1 - gl.r0 + 1 }
    : { x: gl.c - 1, y: gl.r - 2, w: 3, h: 4 };
  if (sp?.snapped) widenLedge(solid, lava, spawn);
  const level: Level = { width: cols, height: rows, tileSize: 8, image, spawn, goal, solid, lava, warnings };
  if (sp && gl && solid.some(row => row.some(Boolean))) {
    const reach = tuneJump(level);
    if (!reach.landed) warnings.push("The stick figure has nothing to stand on, so you start by falling. Draw a line under it.");
    else if (!reach.reachable) warnings.push("I couldn't find a way to reach the flag. Try drawing the platforms a bit closer together.");
  }

  let error: string | undefined;
  if (!sp) error = "I couldn't find the stick figure. Draw one where the player starts and snap again.";
  else if (!gl) error = "I couldn't find the flag. Draw a flag and snap again.";
  else if (!solid.some(row => row.some(Boolean))) error = "I couldn't find any platforms. Draw lines with a dark pen and snap again.";
  return { level, error };
}

/** The line under the stick figure is often a short dash. Make it at least 5 tiles wide so the first jump is fair. */
export function widenLedge(solid: boolean[][], lava: boolean[][], spawn: { x: number; y: number; h?: number }) {
  const rows = solid.length, cols = solid[0]?.length ?? 0, cx = Math.floor(spawn.x);
  const lo = Math.max(1, Math.floor(spawn.y)), hi = Math.min(rows - 1, Math.floor(spawn.y + (spawn.h ?? 6) + 3));
  for (let r = lo; r <= hi; r++) {
    if (![-1, 0, 1].some(d => solid[r][cx + d])) continue;
    for (let c = Math.max(0, cx - 2); c <= Math.min(cols - 1, cx + 2); c++) if (!lava[r][c] && !lava[r - 1][c] && !solid[r - 1][c]) solid[r][c] = true;
    return;
  }
}

/** Kids space platforms by eye, relative to their figure. If the default jump can't reach the flag, raise it
 *  step by step (up to 3.2 figure heights) and keep the smallest jump that works, so the level stays a challenge. */
export function tuneJump(level: Level) {
  let reach = checkReach(level);
  if (!reach.landed || reach.reachable) return reach;
  const { figH, jumpH } = physicsFor(level.spawn.h, level.tileSize);
  for (let h = jumpH * 1.1; h <= Math.max(jumpH, figH * 3.2); h *= 1.1) {
    level.jumpH = Math.round(h);
    reach = checkReach(level);
    if (reach.reachable) { level.jumpH = Math.round(h * 1.05); return reach; } // a little slack for real hands
  }
  delete level.jumpH;
  return checkReach(level);
}
