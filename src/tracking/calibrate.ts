// The paper under the camera to the level. The user clicks the corners in reading order
// (top left, top right, bottom right, bottom left of the drawing), so a rotated or mirrored camera just works.
import { homography, type Pt } from "@/level/ink";
import type { Box } from "@/lib/sam";

export type Homography = number[];
export type Calibration = { ok: true; H: Homography } | { ok: false; error: string };

const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

export function fullFrameCorners(w: number, h: number): Pt[] { return [[0, 0], [w, 0], [w, h], [0, h]]; }

/** The whole picture, turned in quarter steps. A phone looking down has no "up", so the player picks it. */
export function turnedCorners(w: number, h: number, turns: number): Pt[] {
  const c = fullFrameCorners(w, h);
  return c.map((_, i) => c[(i + turns) % 4]);
}

export function calibrate(corners: Pt[], levelW: number, levelH: number, minArea = 400): Calibration {
  const bad: Calibration = { ok: false, error: "Those corners don't make a page. Click them again in order around the paper." };
  if (corners.length !== 4) return bad;
  const turns = corners.map((_, i) => cross(corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]));
  if (!turns.every(t => t > 0) && !turns.every(t => t < 0)) return bad; // crossed, or three in a line
  const area = Math.abs(corners.reduce((a, p, i) => { const q = corners[(i + 1) % 4]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  if (area < minArea) return bad;
  return { ok: true, H: homography(corners, fullFrameCorners(levelW, levelH)) };
}

export function toLevel(H: Homography, x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** A camera box as a level rectangle: centre plus size. */
export function boxToLevel(H: Homography, b: Box) {
  const ps = ([[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]] as Pt[]).map(([x, y]) => toLevel(H, x, y));
  const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** Mover.shape: a solid rectangle in tiles. The scene won't go below 2 x 1. */
export function noteShape(r: { w: number; h: number }, tile: number): boolean[][] {
  const cols = Math.max(2, Math.round(r.w / tile)), rows = Math.max(1, Math.round(r.h / tile));
  return Array.from({ length: rows }, () => Array<boolean>(cols).fill(true));
}
