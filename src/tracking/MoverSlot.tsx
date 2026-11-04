"use client";
// Sticky notes under a camera become live platforms. Off until the player asks, so the game never needs a camera.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Hooks } from "@/game/hooks";
import type { Level } from "@/schema/level";
import { cameraError, chooseCamera, iphoneHint, listCameras, loadCameraId, saveCameraId, type Cam } from "./camera";
import { Rig, type Stats } from "./rig";
import s from "./moverSlot.module.css";

/** Rollback: false removes the whole feature from the play page. */
export const MOVERS_ENABLED = true;

const CORNERS = ["top left", "top right", "bottom right", "bottom left"];
type Phase = "off" | "opening" | "corners" | "find" | "live";

const noSubscribe = () => () => {};
const readDebug = () => new URLSearchParams(window.location.search).get("debug") === "1";
const noDebug = () => false;

export default function MoverSlot(props: { hooks: Hooks | null; level: Level }) {
  return MOVERS_ENABLED ? <Slot {...props} /> : null;
}

function Slot({ hooks, level }: { hooks: Hooks | null; level: Level }) {
  const rig = useRef<Rig | null>(null);
  const [phase, setPhase] = useState<Phase>("off");
  const [hidden, setHidden] = useState(false);
  const [cams, setCams] = useState<Cam[]>([]);
  const [camId, setCamId] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [corners, setCorners] = useState(0);
  const [finding, setFinding] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const debug = useSyncExternalStore(noSubscribe, readDebug, noDebug);

  const stop = () => {
    rig.current?.close();
    rig.current = null;
    setPhase("off"); setHidden(false); setError(null); setWarnings([]); setCorners(0); setStats(null);
  };

  // A new game means new hooks, and the old movers went with the old game.
  useEffect(() => () => { rig.current?.close(); rig.current = null; setPhase("off"); }, [hooks]);

  const start = async () => {
    if (!hooks) return;
    setError(null); setWarnings([]); setPhase("opening");
    const r = new Rig(hooks, { w: level.width * level.tileSize, h: level.height * level.tileSize, tile: level.tileSize }, setStats,
      () => setError("The camera stopped. Pick it again below."));
    rig.current = r;
    try {
      const list = await listCameras();
      const id = chooseCamera(list, loadCameraId());
      setCams(list);
      setHint(iphoneHint(list, navigator.userAgent));
      if (!id) { r.close(); rig.current = null; setPhase("off"); setError("No camera found. Plug one in, or open Continuity Camera: iPhone near Mac, same Apple ID."); return; }
      setCamId(id);
      await r.open(id);
      saveCameraId(id);
      setPhase("corners");
    } catch (e) {
      r.close(); rig.current = null;
      setPhase("off"); setError(cameraError(e));
    }
  };

  const pick = async (id: string) => {
    const r = rig.current;
    if (!r) return;
    setError(null); setCamId(id);
    try {
      r.session.clear(); // positions from the old camera mean nothing on the new one
      r.corners = []; setCorners(0);
      await r.open(id);
      saveCameraId(id);
      setPhase("corners");
    } catch (e) { setError(cameraError(e)); }
  };

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = rig.current;
    if (!r || phase !== "corners") return;
    const b = e.currentTarget.getBoundingClientRect();
    const err = r.addCorner((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
    setError(err);
    setCorners(r.corners.length);
    if (r.corners.length === 4) setPhase(r.session.count ? "live" : "find");
  };

  const wholeFrame = () => { const r = rig.current; if (!r) return; r.useWholeFrame(); setCorners(4); setError(null); setPhase(r.session.count ? "live" : "find"); };
  const redoCorners = () => { const r = rig.current; if (!r) return; r.corners = []; setCorners(0); setPhase("corners"); };

  const find = async () => {
    const r = rig.current;
    if (!r || finding) return;
    setFinding(true); setError(null); setWarnings([]);
    const res = await r.findNotes();
    if (rig.current !== r) return;
    setFinding(false);
    setError(res.error ?? null);
    setWarnings(res.warnings);
    if (r.session.count) {
      setPhase("live");
      if (!res.error && !res.warnings.length) setHidden(true); // out of the way of the game; "Show camera" brings it back
    }
  };

  const removeLast = () => { const r = rig.current; if (!r) return; r.session.removeLast(); setWarnings([]); if (!r.session.count) setPhase("find"); };

  // Buttons must not keep focus, or Space (jump) would press them again.
  const release = (e: React.MouseEvent) => { if (e.target instanceof HTMLElement) e.target.closest("button")?.blur(); };

  if (phase === "off") return (
    <div className={s.bar} onClick={release}>
      {error && <span className={s.error} role="alert">{error}</span>}
      <button className={s.btn} disabled={!hooks} onClick={start}>Add sticky notes</button>
    </div>
  );

  const notes = stats?.notes ?? 0;
  const lost = stats?.lost ?? 0;
  return (
    <div className={s.bar} onClick={release}>
      {phase === "live" && <span className={s.status} aria-live="polite">{lost ? "Looking for a lost note…" : `Following ${notes} note${notes === 1 ? "" : "s"}`}</span>}
      {hidden && <button className={s.btn} onClick={() => setHidden(false)}>Show camera</button>}
      {debug && stats && (
        <div className={s.hud} data-testid="mover-hud">
          <span>{stats.fps.toFixed(0)} fps</span>
          <span>{stats.ms.toFixed(1)} ms</span>
          <span>SAM calls {stats.calls}, every {(stats.gapMs / 1000).toFixed(0)} s{stats.paused ? " (paused)" : ""}</span>
          {stats.flash && <b className={s.flash}>SAM re-anchor</b>}
        </div>
      )}
      <section className={s.panel} hidden={hidden} aria-label="Sticky notes">
        <header className={s.head}>
          <h2>Sticky notes</h2>
          <div className={s.row}>
            <button className={s.ghost} onClick={() => setHidden(true)}>Hide</button>
            <button className={s.ghost} onClick={stop}>Stop camera</button>
          </div>
        </header>
        {phase === "opening" ? <p>Opening the camera…</p> : <>
          <label className={s.field}>Camera
            <select value={camId} onChange={e => { const id = e.target.value; e.target.blur(); void pick(id); }}>
              {cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
            </select>
          </label>
          {hint && <p className={s.hint}>{hint}</p>}
          <canvas className={phase === "corners" ? `${s.view} ${s.pickable}` : s.view} data-testid="mover-view" ref={el => { if (rig.current) rig.current.view = el; }} onClick={click} />
          {phase === "corners" && <>
            <p>Click the <b>{CORNERS[Math.min(corners, 3)]}</b> corner of your drawing ({corners + 1} of 4).</p>
            <div className={s.row}>
              <button className={s.ghost} onClick={wholeFrame}>Use the whole picture</button>
              {corners > 0 && <button className={s.ghost} onClick={redoCorners}>Start corners again</button>}
            </div>
          </>}
          {phase !== "corners" && (
            <div className={s.row}>
              <button className={s.btn} disabled={finding} onClick={find}>{finding ? "Looking…" : phase === "live" ? "Find more notes" : "Find notes"}</button>
              {phase === "live" && <button className={s.ghost} onClick={removeLast}>Remove last note</button>}
              <button className={s.ghost} onClick={redoCorners}>Redo corners</button>
            </div>
          )}
          {phase === "find" && <p className={s.hint}>Put a bright blue or green note on the paper, keep your hands clear, then press Find notes.</p>}
          {warnings.map(w => <p key={w} className={s.warn}>{w}</p>)}
        </>}
        {error && <p className={s.error} role="alert">{error}</p>}
      </section>
    </div>
  );
}
