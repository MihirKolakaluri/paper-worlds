"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Engine } from "../engine";
import { MIN_TALK_SEC, micErrorMessage, openMic, Take, type Mic } from "./record";
import { SoundDetector, type Sound } from "./sounds";
import s from "../RuleSlot.module.css";

type Props = {
  engine: Engine;
  /** Runs the typed rule flow on what was said. */
  onText: (text: string) => Promise<unknown>;
  onError: (message: string) => void;
  onMicChange: (on: boolean) => void;
};
type State = "off" | "opening" | "calibrating" | "on" | "talking" | "sending";

const CALIBRATE_MS = 2000;
const TALK_KEY = "KeyT"; // R is already Restart
const TRANSCRIBE_TIMEOUT_MS = 20_000;
const WORDS: Record<Sound, string> = { whistle: "Heard a whistle", clap: "Heard a double clap" };

async function transcribe(wav: ArrayBuffer): Promise<{ text: string } | { error: string }> {
  try {
    const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.text) return { text: body.text };
    return { error: body?.error ?? "Something went wrong. Try again." };
  } catch { return { error: "Can't reach the AI. Check your connection, or type your rule." }; }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export default function VoiceControls({ engine, onText, onError, onMicChange }: Props) {
  const [state, setStateRaw] = useState<State>("off");
  const [note, setNote] = useState("");
  const live = useRef<{ mic: Mic; detector: SoundDetector; take: Take | null; state: State } | null>(null);
  const keys = useRef(new Set<string>());

  const gone = useRef(false);
  const setState = useCallback((next: State) => { if (live.current) live.current.state = next; setStateRaw(next); }, []);

  const turnOff = useCallback(() => {
    live.current?.mic.close(); live.current = null;
    setStateRaw("off"); setNote(""); onMicChange(false);
  }, [onMicChange]);

  const calibrate = useCallback(() => {
    if (!live.current) return;
    setState("calibrating"); setNote("Stay quiet for 2 seconds…");
    live.current.detector.calibrate(CALIBRATE_MS, () => { setState("on"); setNote("Listening for whistles and double claps."); });
  }, [setState]);

  const turnOn = async () => {
    setStateRaw("opening"); onError("");
    try {
      const mic = await openMic(frame => {
        const v = live.current;
        if (!v) return;
        if (v.take?.push(frame)) stopRef.current();
        v.detector.push(frame);
      });
      if (gone.current) { mic.close(); return; } // left the page during the permission prompt
      const detector = new SoundDetector(mic.rate, sound => { engine.fire(sound); setNote(WORDS[sound]); });
      live.current = { mic, detector, take: null, state: "opening" };
      onMicChange(true);
      calibrate();
    } catch (e) {
      setStateRaw("off"); onError(micErrorMessage(e));
    }
  };

  const startTalk = useCallback(() => {
    const v = live.current;
    if (!v || v.state !== "on") return;
    v.detector.setPaused(true); // your own voice must not fire rules
    v.take = new Take(v.mic.rate);
    setState("talking"); setNote("Talking… let go when you're done.");
  }, [setState]);

  const stopTalk = useCallback(async () => {
    const v = live.current;
    if (!v?.take) return;
    const take = v.take;
    v.take = null;
    v.detector.setPaused(false);
    if (take.seconds < MIN_TALK_SEC) { setState("on"); setNote("Hold it down while you talk."); return; }
    setState("sending"); setNote("Listening to what you said…");
    const out = await transcribe(take.wav());
    if (!live.current) return;
    if ("error" in out) { setState("on"); setNote(""); onError(out.error); return; }
    setNote(`You said: “${out.text}”`);
    await onText(out.text);
    if (live.current) setState("on");
  }, [setState, onError, onText]);

  // the audio callback lives longer than a render, so it reaches stopTalk through a ref
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => { stopRef.current = () => { void stopTalk(); }; }, [stopTalk]);

  useEffect(() => {
    const held = keys.current;
    // capture phase: keys typed in the rule box stop propagating, and their clicks still need ignoring
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!held.has(e.code)) { held.add(e.code); live.current?.detector.keyDown(); }
      if (e.code === TALK_KEY && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) startTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (held.delete(e.code)) live.current?.detector.keyUp();
      if (e.code === TALK_KEY) void stopTalk();
    };
    const left = () => { held.forEach(() => live.current?.detector.keyUp()); held.clear(); void stopTalk(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", left);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", left); };
  }, [startTalk, stopTalk]);

  useEffect(() => {
    gone.current = false;
    return () => { gone.current = true; live.current?.mic.close(); live.current = null; onMicChange(false); };
  }, [engine, onMicChange]);

  if (state === "off" || state === "opening") {
    return <div className={s.voice}><button className={s.mic} disabled={state === "opening"} onClick={turnOn}>{state === "opening" ? "Starting mic…" : "Turn on mic"}</button></div>;
  }
  return (
    <div className={s.voice}>
      <button
        className={`${s.mic} ${state === "talking" ? s.talking : ""}`} disabled={state !== "on" && state !== "talking"}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startTalk(); }}
        onPointerUp={() => void stopTalk()} onPointerCancel={() => void stopTalk()}
        onClick={e => { if (e.detail > 0) e.currentTarget.blur(); }}
      >{state === "talking" ? "Talking…" : "Hold to talk (T)"}</button>
      <span className={s.note} aria-live="polite">{note}</span>
      <button className={s.clear} disabled={state !== "on"} onClick={e => { if (e.detail > 0) e.currentTarget.blur(); calibrate(); }}>Recalibrate</button>
      <button className={s.clear} onClick={turnOff}>Mic off</button>
    </div>
  );
}
