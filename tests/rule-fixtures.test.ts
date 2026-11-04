import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileSentence, IMMEDIATE_SEC } from "@/rules/compile";
import { Rule } from "@/schema/rule";

// Real Muse Wonder answers, saved word for word in fixtures/wonder.
const load = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../fixtures/wonder", `${name}.json`), "utf8")) as { sentence: string; output_text: string };
const replay = (name: string) => { const f = load(name); return compileSentence(f.sentence, async () => f.output_text, "fixture"); };

describe("saved Wonder answers", () => {
  it.each([
    ["lava-whistle", { mode: "every", trigger: { type: "whistle" }, action: { type: "raise_lava", px: 32 } }],
    ["gravity-clap", { mode: "every", trigger: { type: "clap" }, action: { type: "flip_gravity" } }],
    ["speed-now", { mode: "once", trigger: { type: "timer", sec: IMMEDIATE_SEC }, action: { type: "speed", x: 2 } }],
    ["lava-timer", { mode: "every", trigger: { type: "timer", sec: 5 }, action: { type: "raise_lava", px: 48 } }],
    ["platform-goal", { trigger: { type: "touch", target: "goal" }, action: { type: "spawn_platform", x: -1, y: -1 } }],
  ])("%s compiles to a valid rule", async (name, want) => {
    const out = await replay(name);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rule).toMatchObject(want);
    expect(Rule.safeParse(out.rule).success).toBe(true);
    expect(out.rule.text.length).toBeGreaterThan(0);
  });

  it("the impossible sentence gives a friendly no, not a rule", async () => {
    const out = await replay("jetpack");
    expect(out).toEqual({ ok: false, status: 422, error: "I can't add jetpacks yet. Try: double speed when I clap" });
  });
});
