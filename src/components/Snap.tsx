"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buildLevel, cropToInk, flatten, paperQuad, type Img, type Mark, type Pt } from "@/level/ink";
import { saveLevel } from "@/lib/levelStore";
import s from "./snap.module.css";

type Stage = { kind: "idle" } | { kind: "corners" } | { kind: "reading"; started: number } | { kind: "error"; message: string };

const MAX_SIDE = 1600;

function toCanvas(img: Img) {
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export default function Snap() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [quad, setQuad] = useState<Pt[]>([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [dims, setDims] = useState({ w: 1, h: 1 });
  const photo = useRef<Img | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
      const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(bmp, 0, 0, c.width, c.height);
      const id = g.getImageData(0, 0, c.width, c.height);
      photo.current = { data: id.data, width: c.width, height: c.height };
      setPhotoUrl(c.toDataURL("image/jpeg", 0.8));
      setDims({ w: c.width, h: c.height });
      setQuad(paperQuad(photo.current));
      setStage({ kind: "corners" });
    } catch {
      setStage({ kind: "error", message: "I couldn't open that photo. Try a JPG or PNG." });
    }
  }

  function movePoint(e: React.PointerEvent) {
    if (drag.current === null || !frame.current) return;
    const r = frame.current.getBoundingClientRect(), p = { width: dims.w, height: dims.h };
    const x = Math.max(0, Math.min(p.width, (e.clientX - r.left) / r.width * p.width));
    const y = Math.max(0, Math.min(p.height, (e.clientY - r.top) / r.height * p.height));
    setQuad(q => q.map((pt, i) => (i === drag.current ? [x, y] : pt)) as Pt[]);
  }

  async function makeLevel() {
    if (!photo.current) return;
    setStage({ kind: "reading", started: Date.now() });
    await new Promise(r => setTimeout(r, 30)); // let the "reading" screen paint before the heavy pixel work
    const page = cropToInk(flatten(photo.current, quad));
    const image = toCanvas(page).toDataURL("image/jpeg", 0.85);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch("/api/read-level", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, w: page.width, h: page.height }), signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setStage({ kind: "error", message: body.error ?? "Something went wrong. Try again." });
      const { level, error } = buildLevel(page, body.marks as Mark[], body.w, body.h, image);
      if (error) return setStage({ kind: "error", message: error });
      saveLevel(level);
      router.push("/play");
    } catch (e) {
      setStage({ kind: "error", message: (e as Error).name === "AbortError" ? "That took too long. Check your connection and try again." : "Couldn't reach the server. Check your connection and try again." });
    } finally { clearTimeout(timer); }
  }

  const pickers = (
    <div className={s.row}>
      <label className={s.btn}>📷 Take a photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => onFile(e.target.files?.[0])} /></label>
      <label className={s.btnGhost}>Upload a photo<input hidden type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} /></label>
    </div>
  );

  if (stage.kind === "corners") {
    const p = { width: dims.w, height: dims.h }, pct = (pt: Pt) => ({ left: `${pt[0] / p.width * 100}%`, top: `${pt[1] / p.height * 100}%` });
    return (
      <main className={s.main}>
        <h2 className={s.h2}>Line up the corners</h2>
        <p className={s.sub}>Drag the 4 dots onto the corners of your paper.</p>
        <div ref={frame} className={s.frame} style={{ aspectRatio: `${p.width} / ${p.height}` }} onPointerMove={movePoint} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={photoUrl} alt="Your drawing" className={s.photo} draggable={false} />
          <svg className={s.svg} viewBox={`0 0 ${p.width} ${p.height}`} preserveAspectRatio="none">
            <polygon points={quad.map(q => q.join(",")).join(" ")} fill="#1d4ed822" stroke="#1d4ed8" strokeWidth={p.width / 300} />
          </svg>
          {quad.map((pt, i) => (
            <button key={i} aria-label={`corner ${i + 1}`} className={s.handle} style={pct(pt)} onPointerDown={e => { e.preventDefault(); drag.current = i; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); }} />
          ))}
        </div>
        <div className={s.row}>
          <button className={s.btn} onClick={makeLevel}>Make my level</button>
          <button className={s.btnGhost} onClick={() => setStage({ kind: "idle" })}>Back</button>
        </div>
      </main>
    );
  }

  return (
    <main className={s.main}>
      <h1 className={s.h1}>Paper Worlds</h1>
      <p className={s.lead}>Draw a game level on paper. Snap a photo. Play it.</p>
      {stage.kind === "reading" ? (
        <div className={s.reading} role="status"><span className={s.spinner} /> Reading your drawing… this takes about 10 seconds.</div>
      ) : (
        <>
          {stage.kind === "error" && <div className={s.error} role="alert">{stage.message}</div>}
          {pickers}
          <Link className={s.link} href="/play?fixture=demo">or try the demo level</Link>
          <section className={s.how}>
            <h3>How to draw a level</h3>
            <ul>
              <li>Dark pen lines are platforms.</li>
              <li>Color an area red for lava.</li>
              <li>Draw a stick figure where you start and a flag where you finish.</li>
              <li>Snap it from straight above, on a dark table if you can.</li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
