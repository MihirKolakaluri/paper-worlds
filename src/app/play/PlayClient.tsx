"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Game from "@/game/Game";
import type { Hooks, Input } from "@/game/hooks";
import { Level } from "@/schema/level";
import { loadLevel } from "@/lib/levelStore";
import RuleSlot from "@/rules/RuleSlot";
import demo from "../../../fixtures/level-demo.json";
import s from "./play.module.css";

export default function PlayClient() {
  const [level, setLevel] = useState<Level | null | "none">(null);
  const [hooks, setHooks] = useState<Hooks | null>(null);
  const [won, setWon] = useState(false);
  const [deaths, setDeaths] = useState(0);
  const [hideWarn, setHideWarn] = useState(false);

  useEffect(() => {
    const fixture = new URLSearchParams(window.location.search).get("fixture");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL and storage only works after mount
    setLevel(fixture === "demo" ? Level.parse(demo) : loadLevel() ?? "none");
  }, []);

  const onReady = useCallback((h: Hooks) => {
    setHooks(h);
    h.onEvent(e => { if (e.type === "win") setWon(true); if (e.type === "start") setWon(false); if (e.type === "die") setDeaths(d => d + 1); });
  }, []);

  if (level === null) return <main className={s.center}>Loading…</main>;
  if (level === "none") return (
    <main className={s.center}>
      <p>No level yet.</p>
      <Link className={s.btn} href="/">Snap a drawing</Link>
      <button className={s.btnGhost} onClick={() => setLevel(Level.parse(demo))}>Try the demo level</button>
    </main>
  );

  const press = (k: keyof Input, v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); if (hooks) hooks.input[k] = v; };
  const pad = (k: keyof Input, label: string) => (
    <button className={s.pad} aria-label={k} onPointerDown={press(k, true)} onPointerUp={press(k, false)} onPointerLeave={press(k, false)} onPointerCancel={press(k, false)}>{label}</button>
  );

  return (
    <main className={s.wrap}>
      <header className={s.top}>
        <Link href="/" className={s.back}>← New drawing</Link>
        <span className={s.stat} aria-live="polite">Falls: {deaths}</span>
        <button className={s.small} onClick={() => hooks?.restart()}>Restart (R)</button>
      </header>
      {level.warnings.length > 0 && !hideWarn && (
        <div className={s.warn}>{level.warnings[0]} <button onClick={() => setHideWarn(true)}>OK</button></div>
      )}
      <div className={s.stage}><Game level={level} onReady={onReady} /></div>
      <RuleSlot hooks={hooks} />
      <p className={s.help}>Arrow keys or WASD to move, Space to jump (tap for a small hop). Reach the flag, dodge the lava.</p>
      <div className={s.pads}>{pad("left", "◀")}{pad("right", "▶")}<span className={s.grow} />{pad("jump", "⤒")}</div>
      {won && (
        <div className={s.win} role="dialog" aria-label="You win">
          <div className={s.card}>
            <h2>You made it!</h2>
            <p>{deaths === 0 ? "No falls. Nice." : `${deaths} fall${deaths === 1 ? "" : "s"} on the way.`}</p>
            <div className={s.row}>
              <button className={s.btn} autoFocus onClick={() => { setDeaths(0); hooks?.restart(); }}>Play again</button>
              <Link className={s.btnGhost} href="/">Draw a new level</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
