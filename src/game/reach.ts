// Can the flag be reached from the start? A quick search over places you can stand, using the same
// jump and run numbers as the game. Generous on purpose: it only flags levels that are clearly impossible.
import type { Level } from "@/schema/level";
import { GRAVITY, physicsFor } from "./physics";

export type Reach = { landed: boolean; reachable: boolean };

const standable = ({ solid, lava }: Level, c: number, r: number) => r > 0 && solid[r][c] && !solid[r - 1][c] && !lava[r - 1][c];

/** The tile the player lands on when the level starts, or null if they fall into lava or off the page. */
function landing(level: Level): [number, number] | null {
  const T = level.tileSize, { PW } = physicsFor(level.spawn.h, T, level.jumpH);
  const cL = Math.max(0, Math.floor(level.spawn.x - PW / 2 / T)), cR = Math.min(level.width - 1, Math.floor(level.spawn.x + PW / 2 / T));
  for (let r = Math.max(1, Math.ceil(level.spawn.y)); r < level.height; r++) for (let c = cL; c <= cR; c++) {
    if (level.lava[r][c]) return null;
    if (standable(level, c, r)) return [c, r];
  }
  return null;
}

/** The most risen lava (px from the bottom) that still leaves the landing spot safe after a fall. */
export function respawnLavaCap(level: Level) {
  const T = level.tileSize, spot = landing(level);
  return spot ? Math.max(0, (level.height - spot[1] - 2) * T) : 0;
}

export function checkReach(level: Level): Reach {
  const T = level.tileSize, { width: cols, height: rows } = level;
  const { PH, PW, jumpH, JUMP, RUN } = physicsFor(level.spawn.h, T, level.jumpH);
  const stand = (c: number, r: number) => standable(level, c, r);

  // 1. where does the player land when the level starts?
  const start = landing(level);
  if (!start) return { landed: false, reachable: false };

  // 2. every place you can stand
  const spots: [number, number][] = [], id = new Map<number, number>();
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) if (stand(c, r)) { id.set(r * cols + c, spots.length); spots.push([c, r]); }

  const airtime = (risePx: number) => { // time until the player comes back down to a height risePx above the start
    const d = JUMP * JUMP - 2 * GRAVITY * risePx;
    return d < 0 ? -1 : (JUMP + Math.sqrt(d)) / GRAVITY;
  };
  const maxReach = RUN * airtime(-rows * T) + PW;
  const g = level.goal, gx0 = g.x * T, gx1 = (g.x + g.w) * T, gy0 = g.y * T, gy1 = (g.y + g.h) * T;
  const hitsGoal = (c: number, r: number) => {
    const feet = r * T, x = c * T + T / 2;
    const dx = Math.max(0, gx0 - x, x - gx1);
    if (gy0 > feet + 1e4 || gy1 < feet - jumpH - PH + 4) return false;
    return dx <= RUN * (2 * JUMP / GRAVITY) * 0.9 + PW / 2;
  };

  const seen = new Uint8Array(spots.length), queue = [id.get(start[1] * cols + start[0])!];
  seen[queue[0]] = 1;
  while (queue.length) {
    const [c, r] = spots[queue.pop()!];
    if (hitsGoal(c, r)) return { landed: true, reachable: true };
    for (let j = 0; j < spots.length; j++) {
      if (seen[j]) continue;
      const [c2, r2] = spots[j];
      const dc = Math.abs(c2 - c);
      if (dc * T > maxReach) continue;
      const walk = dc === 1 && Math.abs(r2 - r) <= 1;
      const rise = (r - r2) * T, t = airtime(rise + 4);
      const jump = rise <= jumpH - 4 && t > 0 && (dc - 1) * T <= RUN * t * 0.9 + PW / 2;
      if (walk || jump) { seen[j] = 1; queue.push(j); }
    }
  }
  return { landed: true, reachable: false };
}
