// The game's public surface. Steps 4 (sticky notes) and 5 (rules) only talk to the game through these.
//   setMoverTarget(id, x, y)  move a sticky-note platform toward (x, y) in level pixels
//   addMover(m) / removeMover(id)
//   applyRule(rule) / removeRule(id)
//   emit(event)               "whistle" | "clap" from the mic detector
//   onTick(cb)                called every frame with the game state
//   onEvent(cb)               "win" | "die" | "start" for the React HUD
import type { Mover } from "@/schema/mover";
import type { Rule } from "@/schema/rule";

export type GameEvent = "whistle" | "clap";
export type HudEvent = { type: "win" } | { type: "die" } | { type: "start" } | { type: "rule"; id: string } | { type: "dodge" } | { type: "ride"; id: string | null } | { type: "progress"; pct: number };
export type GameState = { x: number; y: number; vx: number; vy: number; onFloor: boolean; deaths: number; won: boolean; lavaTop: number; gravityFlipped: boolean; riding: boolean };
export type Input = { left: boolean; right: boolean; jump: boolean };

export interface Hooks {
  setMoverTarget(id: string, x: number, y: number): void;
  /** 1 is fully visible, 0 is invisible. Display only: a mover stays solid until removeMover. */
  setMoverAlpha(id: string, alpha: number): void;
  addMover(m: Mover): void;
  /** The hero rides this mover instead of walking, and scribbles start. Null hands control back to the keys. */
  setRide(id: string | null): void;
  /** Asteroid Surf: 1 is normal, more is harder. */
  setDifficulty(level: number): void;
  removeMover(id: string): void;
  applyRule(rule: Rule): void;
  removeRule(id: string): void;
  emit(event: GameEvent): void;
  onTick(cb: (s: GameState) => void): () => void;
  onEvent(cb: (e: HudEvent) => void): () => void;
  restart(): void;
  /** On-screen buttons for phones write here; keyboard works without it. */
  input: Input;
}
