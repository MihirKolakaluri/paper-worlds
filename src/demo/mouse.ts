import type { Level } from "@/schema/level";
import type { Mover } from "@/schema/mover";

type Size = Pick<Level, "width" | "height" | "tileSize">;
type Rect = { left: number; top: number; width: number; height: number };

export const DEMO_MOVER_ID = "demo-note";
const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

/** Where the pointer is, in level pixels. `rect` is the canvas on screen, which is scaled to fit. */
export function pointerToLevel(clientX: number, clientY: number, rect: Rect, level: Size) {
  const W = level.width * level.tileSize, H = level.height * level.tileSize;
  return { x: clamp((clientX - rect.left) / rect.width * W, W), y: clamp((clientY - rect.top) / rect.height * H, H) };
}

/** The stand-in for a sticky note: a platform you steer with the mouse or a finger. */
export function demoMover(level: Size): Mover {
  return {
    id: DEMO_MOVER_ID, color: "green", hsv: { hMin: 0, hMax: 0, sMin: 0, vMin: 0 },
    shape: Array.from({ length: 2 }, () => Array<boolean>(12).fill(true)),
    pos: { x: level.width * level.tileSize / 2, y: level.height * level.tileSize / 2 },
  };
}
