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
    el.style.setProperty("touch-action", "none"); // a finger steers the platform instead of scrolling the page
    return () => { el.removeEventListener("pointermove", move); el.style.removeProperty("touch-action"); hooks.removeMover(DEMO_MOVER_ID); };
  }, [on, hooks, level, stage]);

  return (
    <div className={s.bar}>
      <button className={s.toggle} aria-pressed={on} onClick={e => { setOn(v => !v); if (e.detail > 0) e.currentTarget.blur(); }}>{on ? "Remove the platform" : "Add a moving platform"}</button>
      {on
        ? <span className={s.hint}><b>Your platform is a bridge</b><br />Steer it under you to cross the lava</span>
        : <span className={s.hint}>Steer a bridge with your mouse or finger</span>}
    </div>
  );
}
