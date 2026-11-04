// Synthetic camera frames for the tracking tests. RGBA, same layout as canvas ImageData.
import type { Img } from "@/level/ink";

export type RGB = [number, number, number];
export const WHITE: RGB = [240, 238, 232], WOOD: RGB = [176, 120, 72], BLUE: RGB = [30, 100, 220], GREEN: RGB = [50, 200, 90], ORANGE: RGB = [205, 125, 60], SKIN: RGB = [224, 172, 140], PALE: RGB = [245, 240, 215];

export function frame(w: number, h: number, bg: RGB = WHITE): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[4 * i] = bg[0]; data[4 * i + 1] = bg[1]; data[4 * i + 2] = bg[2]; data[4 * i + 3] = 255; }
  return { data, width: w, height: h };
}
export function rect(img: Img, cx: number, cy: number, w: number, h: number, c: RGB) {
  const x0 = Math.max(0, Math.round(cx - w / 2)), x1 = Math.min(img.width, Math.round(cx + w / 2));
  const y0 = Math.max(0, Math.round(cy - h / 2)), y1 = Math.min(img.height, Math.round(cy + h / 2));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = 4 * (y * img.width + x); img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; }
  return img;
}
/** Deterministic camera noise so tests don't pass only on perfect flat colours. */
export function noise(img: Img, amp = 8, seed = 1) {
  let s = seed;
  for (let i = 0; i < img.data.length; i++) {
    if (i % 4 === 3) continue;
    s = (s * 1664525 + 1013904223) >>> 0;
    img.data[i] = img.data[i] + ((s >>> 16) % (2 * amp + 1)) - amp;
  }
  return img;
}
