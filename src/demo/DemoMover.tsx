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
    hooks.setRide(DEMO_MOVER_ID);
    const move = (e: PointerEvent) => {
      const canvas = el.querySelector("canvas");
      if (!canvas) return;
      const p = pointerToLevel(e.clientX, e.clientY, canvas.getBoundingClientRect(), level);
      hooks.setMoverTarget(DEMO_MOVER_ID, p.x, p.y);
    };
    el.addEventListener("pointermove", move);
    el.style.setProperty("touch-action", "none"); // a finger steers the platform instead of scrolling the page
    return () => { el.removeEventListener("pointermove", move); el.style.removeProperty("touch-action"); hooks.setRide(null); hooks.removeMover(DEMO_MOVER_ID); };
  }, [on, hooks, level, stage]);

  return (
    <div className={s.bar}>
      <button className={s.toggle} aria-pressed={on} onClick={e => { setOn(v => !v); if (e.detail > 0) e.currentTarget.blur(); }}>{on ? "Stop riding" : "Ride a plank"}</button>
      {on
        ? <span className={s.hint}><b>Steer with your mouse or finger</b><br />Dodge the scribbles and reach the flag</span>
        : <span className={s.hint}>Steer with your mouse or finger. A real sticky note does this under a camera.</span>}
    </div>
  );
}
