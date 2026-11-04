// The list of rules in play. The scene runs them (once/every, timers, touch); this keeps the 5 rule limit, cleans
// rules that never went through the compiler (presets) and tells the chips what happened.
import type { GameEvent, Hooks } from "@/game/hooks";
import { clampRaise, clampSpeed } from "@/game/rules";
import { Rule } from "@/schema/rule";
import { IMMEDIATE_SEC, MAX_FREEZE_SEC, MIN_EVERY_SEC } from "./compile";

export const MAX_RULES = 5;
export const FULL_ERROR = `You have ${MAX_RULES} rules, that's the limit. Remove one first.`;

export type Live = { rule: Rule; fired: number };
export type AddResult = { ok: true } | { ok: false; error: string };

function clean(rule: Rule): Rule {
  const a = rule.action, t = rule.trigger;
  const action: Rule["action"] =
    a.type === "raise_lava" ? { ...a, px: clampRaise(a.px) } :
    a.type === "speed" ? { ...a, x: clampSpeed(a.x) } :
    a.type === "freeze_movers" ? { ...a, sec: Math.min(MAX_FREEZE_SEC, a.sec) } : a;
  const trigger: Rule["trigger"] = t.type === "timer" && rule.mode === "every" ? { ...t, sec: Math.max(MIN_EVERY_SEC, t.sec) } : t;
  return { ...rule, action, trigger };
}

let nextId = 1;

export function createEngine(hooks: Hooks) {
  let live: Live[] = [];
  const listeners = new Set<() => void>();
  const set = (next: Live[]) => { live = next; listeners.forEach(cb => cb()); };
  let stopEvents: (() => void) | null = null;

  return {
    id: nextId++,
    add(input: Rule): AddResult {
      const parsed = Rule.safeParse(input);
      if (!parsed.success) return { ok: false, error: "That rule doesn't work." };
      const rule = clean(parsed.data);
      if (live.some(l => l.rule.id === rule.id)) return { ok: true };
      // "restart" with no trigger is a command, not a rule: kept as a rule it would refire on every restart, forever
      if (rule.action.type === "reset" && rule.trigger.type === "timer" && rule.trigger.sec <= IMMEDIATE_SEC) { hooks.restart(); return { ok: true }; }
      if (live.length >= MAX_RULES) return { ok: false, error: FULL_ERROR };
      hooks.applyRule(rule);
      set([...live, { rule, fired: 0 }]);
      return { ok: true };
    },
    remove(id: string) { hooks.removeRule(id); set(live.filter(l => l.rule.id !== id)); },
    clear() { live.forEach(l => hooks.removeRule(l.rule.id)); set([]); },
    fire(e: GameEvent) { hooks.emit(e); },
    full: () => live.length >= MAX_RULES,
    needsSound: () => live.some(l => l.rule.trigger.type === "whistle" || l.rule.trigger.type === "clap"),
    snapshot: () => live,
    subscribe(cb: () => void) {
      listeners.add(cb);
      stopEvents ??= hooks.onEvent(e => {
        if (e.type === "rule") set(live.map(l => (l.rule.id === e.id ? { ...l, fired: l.fired + 1 } : l)));
        if (e.type === "start" && live.some(l => l.fired)) set(live.map(l => ({ ...l, fired: 0 })));
      });
      return () => { listeners.delete(cb); if (!listeners.size) { stopEvents?.(); stopEvents = null; } };
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
