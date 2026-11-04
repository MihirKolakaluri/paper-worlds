"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Hooks } from "@/game/hooks";
import type { Rule } from "@/schema/rule";
import { MAX_SENTENCE } from "./compile";
import { createEngine, FULL_ERROR, type Live } from "./engine";
import { VOICE_ON } from "./voice/flag";
import VoiceControls from "./voice/VoiceControls";
import s from "./RuleSlot.module.css";

export type RulePreset = { label: string; rule: Rule };
type Props = {
  hooks: Hooks | null;
  /** One click chips that apply the given Rule with no API call. */
  presets?: RulePreset[];
  /** Hides the mic controls. Whistle and clap rules then fire from the on-screen buttons or keys 1 and 2. */
  demo?: boolean;
};

const NONE: Live[] = [];
const noStore = () => () => {};
const COMPILE_TIMEOUT_MS = 45_000; // two Wonder tries of 20 s, plus the trip

async function compile(text: string): Promise<{ rule: Rule } | { error: string }> {
  try {
    const res = await fetch("/api/compile-rule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.rule) return { rule: body.rule };
    return { error: body?.error ?? "Something went wrong. Try again." };
  } catch (e) {
    return { error: e instanceof DOMException && e.name === "TimeoutError" ? "The AI took too long. Try again." : "Can't reach the AI. Check your connection and try again." };
  }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
/** After a mouse click, hand the keyboard back to the game so Space jumps instead of pressing this button again. */
const release = (e: React.MouseEvent<HTMLButtonElement>) => { if (e.detail > 0) e.currentTarget.blur(); };

export default function RuleSlot({ hooks, presets, demo = false }: Props) {
  const engine = useMemo(() => (hooks ? createEngine(hooks) : null), [hooks]);
  const rules = useSyncExternalStore(engine?.subscribe ?? noStore, engine?.snapshot ?? (() => NONE), () => NONE);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  const addRule = useCallback((rule: Rule) => {
    const out = engine?.add(rule);
    setError(out && !out.ok ? out.error : "");
    return !!out?.ok;
  }, [engine]);

  const submit = useCallback(async (sentence: string) => {
    const clean = sentence.trim();
    if (!clean || !engine) return false;
    if (engine.full()) { setError(FULL_ERROR); return false; }
    setBusy(true); setError("");
    const out = await compile(clean);
    setBusy(false);
    if ("error" in out) { setError(out.error); return false; }
    return addRule(out.rule);
  }, [engine, addRule]);

  // stand-ins for the mic: 1 = whistle, 2 = double clap
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target)) return;
      if (e.key === "1") engine.fire("whistle");
      if (e.key === "2") engine.fire("clap");
    };
    // Phaser cancels mouse presses on the canvas, so clicking the game would otherwise leave the box focused
    const onPress = (e: PointerEvent) => { if (e.target !== box.current) box.current?.blur(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPress, true); };
  }, [engine]);

  // Phaser swallows game keys at the window, so stop them here or the box can't type A, D, W, R or Space.
  // Only keydown: the matching keyup must still reach Phaser or a key held while clicking in would stick.
  const onBoxKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") e.currentTarget.blur();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await submit(text)) { setText(""); box.current?.blur(); }
  };

  const soundKeys = engine?.needsSound() && !micOn;
  const unused = presets?.filter(p => !rules.some(l => l.rule.id === p.rule.id)) ?? [];

  return (
    <section className={s.slot} aria-label="Rules">
      <form className={s.form} onSubmit={onSubmit}>
        <input
          ref={box} className={s.box} value={text} maxLength={MAX_SENTENCE} disabled={!engine}
          onChange={e => { setText(e.target.value); setError(""); }} onKeyDown={onBoxKey}
          placeholder={demo ? "Try: double speed" : "Type a rule: make the lava rise every time I whistle"} aria-label="Type a rule"
          autoComplete="off" spellCheck={false} enterKeyHint="done"
        />
        <button className={s.add} disabled={busy || !text.trim() || !engine} onClick={release}>{busy ? "Thinking…" : "Add rule"}</button>
      </form>
      {error && <p className={s.error} role="alert">{error}</p>}
      {(rules.length > 0 || unused.length > 0 || soundKeys) && (
        <div className={s.chips}>
          {rules.map(({ rule, fired }) => (
            <span key={rule.id} className={`${s.chip} ${rule.mode === "once" && fired ? s.used : ""}`}>
              <span key={fired} className={fired ? s.flash : undefined}>{rule.text}</span>
              <button className={s.x} aria-label={`Undo rule: ${rule.text}`} onClick={e => { release(e); setError(""); engine?.remove(rule.id); }}>×</button>
            </span>
          ))}
          {rules.length > 1 && <button className={s.clear} onClick={e => { release(e); setError(""); engine?.clear(); }}>Clear all</button>}
          {unused.map(p => (
            <button key={p.rule.id} className={s.preset} onClick={e => { release(e); addRule(p.rule); }}>+ {p.label}</button>
          ))}
          {soundKeys && (
            <span className={s.sounds}>
              <button className={s.sound} onClick={e => { release(e); engine?.fire("whistle"); }}>Whistle (1)</button>
              <button className={s.sound} onClick={e => { release(e); engine?.fire("clap"); }}>Clap (2)</button>
            </span>
          )}
        </div>
      )}
      {VOICE_ON && !demo && engine && <VoiceControls key={engine.id} engine={engine} onText={submit} onError={setError} onMicChange={setMicOn} />}
    </section>
  );
}
