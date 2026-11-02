// Player size, run speed and jump, all scaled from the kid's own stick figure (a big drawing gets a big
// player and big jumps). Pure, so the level reader can check a level is beatable with the same numbers.
export const GRAVITY = 1300;
export const COYOTE_MS = 100; // you can still jump this long after running off a ledge
export const BUFFER_MS = 100; // a jump pressed this long before landing still counts

export function physicsFor(spawnH: number | undefined, T = 8, jumpOverride?: number) {
  const figH = Math.max(24, Math.min(96, (spawnH ?? 6) * T));
  const PH = Math.round(Math.max(16, Math.min(44, figH * 0.6))), PW = Math.round(PH * 0.55);
  const jumpH = jumpOverride ?? Math.max(72, figH * 1.7); // px the player rises on a full jump
  const JUMP = Math.sqrt(2 * GRAVITY * jumpH);
  const RUN = Math.max(130, Math.min(280, figH * 3.2));
  return { figH, PH, PW, jumpH, JUMP, RUN };
}
