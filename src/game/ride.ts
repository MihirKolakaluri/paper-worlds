// Controller mode: the hero rides a plank you steer with your hand and dodges scribbles. Pure, so it can be tested.
export const CHASE = 20; // higher reacts faster, which a real camera's delay needs
const MAX_SPEED = 1400;
const RAMP_MS = 60_000;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The hero's speed sideways: same chase as the plank, so the two stay together. */
export function rideVelocity(plankX: number, heroX: number) {
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (plankX - heroX) * CHASE));
}

/** How often scribbles come and how fast, after this long riding. */
export function scribbleWave(elapsedMs: number) {
  const t = Math.min(1, elapsedMs / RAMP_MS);
  return { gapMs: Math.round(lerp(1800, 750, t)), speed: Math.round(lerp(200, 460, t)) };
}

/** Where a scribble comes in. `n` counts them and `rand` is 0 to 1. */
export function scribbleY(n: number, rand: number, heroY: number, levelH: number) {
  return n % 3 === 0 ? heroY : Math.round(lerp(40, levelH - 40, rand));
}
