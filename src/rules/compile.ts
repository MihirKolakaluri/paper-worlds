// One sentence in, one safe Rule out. Pure apart from the `ask` function passed in, so saved Wonder answers can be
// replayed in tests. Wonder answers in a flat "wire" shape (strict structured output has no unions); the game's
// Rule is a tagged union, so wireToRule maps one to the other and never trusts the model's numbers.
import { z } from "zod";
import { clampRaise, clampSpeed } from "@/game/rules";
import { Rule } from "@/schema/rule";

export const FALLBACK_ERROR = "I can't do that yet. Try: when I clap, flip gravity";
export const NO_ANSWER_ERROR = "The AI didn't answer. Wait a moment and try again.";

/** The Rule schema needs sec > 0, so "no trigger, do it now" is a one-shot timer this short. */
export const IMMEDIATE_SEC = 0.05;
export const MIN_EVERY_SEC = 1;
export const MAX_TIMER_SEC = 60;
export const MAX_FREEZE_SEC = 30;
export const MAX_SENTENCE = 200;
const MAX_TEXT = 60;
const MAX_ERROR = 160;
const DEFAULT_RAISE_PX = 32;
const DEFAULT_SPEED = 2;
const DEFAULT_FREEZE_SEC = 5;
const PLATFORM_TILES = 10;

export const WIRE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["ok", "text", "mode", "trigger", "action", "error"],
  properties: {
    ok: { type: "boolean" },
    text: { type: "string" },
    mode: { type: "string", enum: ["once", "every"] },
    trigger: {
      type: "object", additionalProperties: false, required: ["type", "sec", "target"],
      properties: {
        type: { type: "string", enum: ["whistle", "clap", "timer", "touch"] },
        sec: { type: "number" },
        target: { type: "string", enum: ["none", "goal", "lava"] },
      },
    },
    action: {
      type: "object", additionalProperties: false, required: ["type", "amount"],
      properties: {
        type: { type: "string", enum: ["raise_lava", "flip_gravity", "spawn_platform", "speed", "freeze_movers", "reset"] },
        amount: { type: "number" },
      },
    },
    error: { type: "string" },
  },
};

export const SYSTEM = `You compile one plain-English game rule for a 2D platformer into JSON.
Triggers: whistle, clap, timer (sec), touch (target goal|lava). Actions: raise_lava (amount = pixels),
flip_gravity, spawn_platform, speed (amount = multiplier), freeze_movers (amount = seconds), reset.
mode is "every" if it should repeat, else "once". A whistle, clap or touch rule repeats ("when I clap" means every clap)
unless the player says once, first or next time. text = the rule restated in 8 words or fewer.
Fields that don't apply: sec=0, target="none", amount=0.
Never invent a trigger the player didn't say. If no trigger is given, use mode "once" with trigger timer sec=0.
If the request needs anything outside these triggers and actions (new items, new abilities, new enemies), set ok=false,
fill the other fields with any valid values and put a short friendly suggestion in error, e.g. "I can't add jetpacks yet. Try: double speed when I clap".`;

const WireRule = z.object({
  ok: z.boolean(),
  text: z.string(),
  mode: z.enum(["once", "every"]),
  trigger: z.object({ type: z.enum(["whistle", "clap", "timer", "touch"]), sec: z.number(), target: z.enum(["none", "goal", "lava"]) }),
  action: z.object({ type: z.enum(["raise_lava", "flip_gravity", "spawn_platform", "speed", "freeze_movers", "reset"]), amount: z.number() }),
  error: z.string(),
});
export type Wire = z.infer<typeof WireRule>;

export function parseWire(text: string): Wire | null {
  try { const out = WireRule.safeParse(JSON.parse(text)); return out.success ? out.data : null; } catch { return null; }
}

function mapTrigger(t: Wire["trigger"], mode: Rule["mode"]): { trigger: Rule["trigger"]; mode: Rule["mode"] } | null {
  switch (t.type) {
    case "whistle": case "clap": return { trigger: { type: t.type }, mode };
    case "touch": return t.target === "none" ? null : { trigger: { type: "touch", target: t.target }, mode };
    case "timer":
      if (!(t.sec > 0)) return { trigger: { type: "timer", sec: IMMEDIATE_SEC }, mode: "once" };
      return { trigger: { type: "timer", sec: Math.min(MAX_TIMER_SEC, mode === "every" ? Math.max(MIN_EVERY_SEC, t.sec) : t.sec) }, mode };
  }
}

function mapAction(a: Wire["action"]): Rule["action"] {
  const n = a.amount > 0 ? a.amount : 0;
  switch (a.type) {
    case "raise_lava": return { type: "raise_lava", px: clampRaise(n || DEFAULT_RAISE_PX) };
    case "speed": return { type: "speed", x: clampSpeed(n || DEFAULT_SPEED) };
    case "freeze_movers": return { type: "freeze_movers", sec: Math.min(MAX_FREEZE_SEC, n || DEFAULT_FREEZE_SEC) };
    // x and y below 0 mean "near the player when it fires": the sentence can't know where that will be
    case "spawn_platform": return { type: "spawn_platform", x: -1, y: -1, w: PLATFORM_TILES };
    case "flip_gravity": case "reset": return { type: a.type };
  }
}

const ACTION_WORDS: Record<Rule["action"]["type"], string> = {
  raise_lava: "Raise the lava", flip_gravity: "Flip gravity", spawn_platform: "Add a platform",
  speed: "Change speed", freeze_movers: "Freeze platforms", reset: "Restart",
};

/** Null when the wire answer can't become a valid Rule, which earns the model one re-ask. */
export function wireToRule(w: Wire, id: string): Rule | null {
  const t = mapTrigger(w.trigger, w.mode);
  if (!t) return null;
  const text = w.text.trim().slice(0, MAX_TEXT) || ACTION_WORDS[w.action.type];
  const out = Rule.safeParse({ id, text, mode: t.mode, trigger: t.trigger, action: mapAction(w.action) });
  return out.success ? out.data : null;
}

export type Ask = (sentence: string, note?: string) => Promise<string>;
export type Compiled = { ok: true; rule: Rule } | { ok: false; status: number; error: string };

/** The body for POST /responses. `note` says why the last answer was refused, for the one re-ask. */
export function wonderRequest(model: string, sentence: string, note?: string) {
  return {
    model,
    instructions: SYSTEM,
    input: [{ type: "message" as const, role: "user" as const, content: [{ type: "input_text" as const, text: note ? `${sentence}\n\n(${note})` : sentence }] }],
    text: { format: { type: "json_schema" as const, name: "rule", schema: WIRE_SCHEMA, strict: true } },
    reasoning: { effort: "minimal" as const },
    max_output_tokens: 4000,
  };
}

export async function compileSentence(sentence: string, ask: Ask, id: string): Promise<Compiled> {
  let note: string | undefined, answered = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text: string;
    try { text = await ask(sentence, note); answered = true; } catch (e) { console.error(`compile-rule attempt ${attempt} failed`, e); continue; }
    const wire = parseWire(text);
    if (wire && !wire.ok) return { ok: false, status: 422, error: wire.error.trim().slice(0, MAX_ERROR) || FALLBACK_ERROR };
    const rule = wire && wireToRule(wire, id);
    if (rule) return { ok: true, rule };
    console.error(`compile-rule attempt ${attempt} unusable answer:`, text.slice(0, 300));
    note = "Your last answer was invalid. Answer with valid JSON, and a touch trigger needs target goal or lava.";
  }
  return answered ? { ok: false, status: 422, error: FALLBACK_ERROR } : { ok: false, status: 502, error: NO_ANSWER_ERROR };
}
