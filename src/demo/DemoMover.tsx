"use client";
import { useEffect, useState, type RefObject } from "react";
import type { Hooks } from "@/game/hooks";
import type { Level } from "@/schema/level";
import { DEMO_MOVER_ID, demoMover, pointerToLevel } from "./mouse";
import s from "./demo.module.css";

/** Try it now's sticky note: the same platform a real note drives, steered with the mouse or a finger. */
export default function DemoMover({ hooks, level, stage }: { hooks: Hooks | null; level: Level; stage: RefObject<HTMLDivElement | null> }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = stage.current;
    if (!on || !hooks || !el) return;
    hooks.addMover(demoMover(level));
    const move = (e: PointerEvent) => {
      const canvas = el.querySelector("canvas");
      if (!canvas) return;
      const p = pointerToLevel(e.clientX, e.clientY, canvas.getBoundingClientRect(), level);
      hooks.setMoverTarget(DEMO_MOVER_ID, p.x, p.y);
    };
    el.addEventListener("pointermove", move);
    el.style.touchAction = "none"; // a finger steers the platform instead of scrolling the page
    return () => { el.removeEventListener("pointermove", move); el.style.touchAction = ""; hooks.removeMover(DEMO_MOVER_ID); };
  }, [on, hooks, level, stage]);

  return (
    <div className={s.bar}>
      <button className={s.toggle} aria-pressed={on} onClick={() => setOn(v => !v)}>{on ? "Remove the platform" : "Add a moving platform"}</button>
      <span className={s.hint}>{on ? "Steer it with your mouse or finger over the game. This is what a sticky note does under the camera." : "A real sticky note does this under a camera. Here your mouse or finger stands in for it."}</span>
    </div>
  );
}
