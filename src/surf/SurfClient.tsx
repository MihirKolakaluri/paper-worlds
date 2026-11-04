"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Game from "@/game/Game";
import type { Hooks } from "@/game/hooks";
import type { Level } from "@/schema/level";
import { DEMO_MOVER_ID, demoMover, pointerToLevel } from "@/demo/mouse";
import { loadSample } from "@/demo/samples";
import MoverSlot from "@/tracking/MoverSlot";
import { surfLevel } from "./level";
import p from "@/app/play/play.module.css";
import s from "./surf.module.css";

const BEST_KEY = "pw-surf-best";

export default function SurfClient() {
  const [level, setLevel] = useState<Level | null>(null);
  const [failed, setFailed] = useState(false);
  const [hooks, setHooks] = useState<Hooks | null>(null);
  const [pct, setPct] = useState(0);
  const [dodged, setDodged] = useState(0);
  const [falls, setFalls] = useState(0);
  const [won, setWon] = useState(false);
  const [note, setNote] = useState(false);
  const [best, setBest] = useState(0);
  const dodgedNow = useRef(0);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSample("a").then(l => setLevel(surfLevel(l))).catch(() => setFailed(true));
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists after mount
      setBest(Number(localStorage.getItem(BEST_KEY)) || 0);
    } catch { /* blocked storage: the best score just lasts this visit */ }
  }, []);

  const onReady = useCallback((h: Hooks) => {
    setHooks(h);
    h.onEvent(e => {
      if (e.type === "progress") setPct(e.pct);
      if (e.type === "dodge") { dodgedNow.current++; setDodged(n => n + 1); }
      if (e.type === "die") setFalls(n => n + 1);
      if (e.type === "win") {
        setWon(true);
        const score = dodgedNow.current;
        setBest(b => { if (score <= b) return b; try { localStorage.setItem(BEST_KEY, String(score)); } catch { /* same */ } return score; });
      }
      if (e.type === "start") { dodgedNow.current = 0; setWon(false); setDodged(0); setFalls(0); setPct(0); }
      if (e.type === "ride") setNote(!!e.id && e.id !== DEMO_MOVER_ID);
      if (e.type === "ride" && e.id === null) setNote(false);
    });
  }, []);

  // The mouse or a finger steers until a real note takes over.
  useEffect(() => {
    const el = stage.current;
    if (!hooks || !level || !el || note) return;
    hooks.addMover(demoMover(level));
    hooks.setRide(DEMO_MOVER_ID);
    const move = (e: PointerEvent) => {
      const canvas = el.querySelector("canvas");
      if (!canvas) return;
      const q = pointerToLevel(e.clientX, e.clientY, canvas.getBoundingClientRect(), level);
      hooks.setMoverTarget(DEMO_MOVER_ID, q.x, q.y);
    };
    el.addEventListener("pointermove", move);
    el.style.setProperty("touch-action", "none");
    return () => { el.removeEventListener("pointermove", move); el.style.removeProperty("touch-action"); hooks.removeMover(DEMO_MOVER_ID); };
  }, [hooks, level, note]);

  if (failed) return <main className={p.center}><p>That didn&apos;t load.</p><Link className={p.btn} href="/">Back home</Link></main>;
  if (!level) return <main className={p.center}>Loading…</main>;

  return (
    <main className={p.wrap}>
      <header className={p.top}>
        <Link href="/" className={p.back}>← Home</Link>
        <span className={`${p.stat} ${s.first}`}>Dodged: {dodged}</span>
        <span className={s.plain} aria-live="polite">Hits: {falls}</span>
        <button className={p.small} onClick={() => hooks?.restart()}>Restart (R)</button>
      </header>
      <div className={s.track} role="progressbar" aria-label="Distance to the end" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={s.fill} style={{ width: `${pct}%` }} /></div>
      <div ref={stage} className={p.stage}>
        <Game level={level} onReady={onReady} />
        <p className={p.intro}>Surf to the end. Dodge the asteroids.</p>
      </div>
      <MoverSlot hooks={hooks} level={level} />
      <div className={s.keys}>
        <span>{note ? "Slide your note to steer" : "Move your mouse or finger to steer"}</span>
        <span className={p.desktop}><kbd>Space</kbd> Jump</span>
      </div>
      {won && (
        <div className={p.win} role="dialog" aria-label="You win">
          <div className={p.card}>
            <h2>You made it!</h2>
            <p>{dodged} dodged. {falls === 0 ? "Not a scratch." : `${falls} hit${falls === 1 ? "" : "s"}.`} Your best is {best}.</p>
            <div className={p.row}>
              <button className={p.btn} autoFocus onClick={() => hooks?.restart()}>Surf again</button>
              <Link className={p.btnGhost} href="/make">Draw your own game</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
