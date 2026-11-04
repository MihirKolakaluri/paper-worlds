import { describe, expect, it, vi } from "vitest";
import { Rule } from "@/schema/rule";
import { compileSentence, FALLBACK_ERROR, IMMEDIATE_SEC, MIN_EVERY_SEC, parseWire, wireToRule, wonderRequest, type Wire } from "@/rules/compile";

const wire = (over: Partial<Wire> = {}): Wire => ({
  ok: true, text: "Lava rises on whistle", mode: "every",
  trigger: { type: "whistle", sec: 0, target: "none" },
  action: { type: "raise_lava", amount: 20 }, error: "", ...over,
});
const toRule = (w: Partial<Wire>) => { const r = wireToRule(wire(w), "id1"); expect(r).not.toBeNull(); return r!; };

describe("wire to Rule mapping", () => {
  it("every mapped rule passes the frozen Rule schema", () => {
    for (const type of ["raise_lava", "flip_gravity", "spawn_platform", "speed", "freeze_movers", "reset"] as const)
      for (const amount of [-5, 0, 1, 2.5, 50, 100000])
        expect(Rule.safeParse(toRule({ action: { type, amount } })).success).toBe(true);
  });
  it("no trigger (timer sec=0) becomes a once rule that runs right away, still valid", () => {
    const r = toRule({ mode: "every", trigger: { type: "timer", sec: 0, target: "none" }, action: { type: "speed", amount: 2 } });
    expect(r.mode).toBe("once");
    expect(r.trigger).toEqual({ type: "timer", sec: IMMEDIATE_SEC });
    expect(Rule.safeParse(r).success).toBe(true);
  });
  it("a negative timer counts as no trigger too", () => {
    expect(toRule({ trigger: { type: "timer", sec: -3, target: "none" } }).trigger).toEqual({ type: "timer", sec: IMMEDIATE_SEC });
  });
  it("keeps a real timer and caps it at the schema's 60 s", () => {
    expect(toRule({ trigger: { type: "timer", sec: 5, target: "none" } }).trigger).toEqual({ type: "timer", sec: 5 });
    expect(toRule({ trigger: { type: "timer", sec: 600, target: "none" } }).trigger).toEqual({ type: "timer", sec: 60 });
  });
  it("a repeating timer can't run faster than once a second", () => {
    expect(toRule({ mode: "every", trigger: { type: "timer", sec: 0.1, target: "none" } }).trigger).toEqual({ type: "timer", sec: MIN_EVERY_SEC });
  });
  it("drops the wire's unused fields", () => {
    expect(toRule({}).trigger).toEqual({ type: "whistle" });
    expect(toRule({ trigger: { type: "touch", sec: 9, target: "goal" } }).trigger).toEqual({ type: "touch", target: "goal" });
  });
  it("touch with no target can't be mapped", () => {
    expect(wireToRule(wire({ trigger: { type: "touch", sec: 0, target: "none" } }), "x")).toBeNull();
  });
  it("clamps amounts and fills defaults because the model's numbers vary", () => {
    const action = (type: Wire["action"]["type"], amount: number) => toRule({ action: { type, amount } }).action;
    expect(action("raise_lava", 1)).toEqual({ type: "raise_lava", px: 8 });
    expect(action("raise_lava", 500)).toEqual({ type: "raise_lava", px: 64 });
    expect(action("raise_lava", 0)).toEqual({ type: "raise_lava", px: 32 });
    expect(action("speed", 10)).toEqual({ type: "speed", x: 2.5 });
    expect(action("speed", 0.1)).toEqual({ type: "speed", x: 0.5 });
    expect(action("speed", 0)).toEqual({ type: "speed", x: 2 });
    expect(action("freeze_movers", 100)).toEqual({ type: "freeze_movers", sec: 30 });
    expect(action("freeze_movers", 0)).toEqual({ type: "freeze_movers", sec: 5 });
  });
  it("a spawned platform has no fixed spot, it appears near the player", () => {
    expect(toRule({ action: { type: "spawn_platform", amount: 3 } }).action).toMatchObject({ type: "spawn_platform", x: -1, y: -1 });
  });
  it("caps chip text, and fills it in when the model leaves it blank", () => {
    expect(toRule({ text: "x".repeat(300) }).text.length).toBeLessThanOrEqual(60);
    expect(toRule({ text: "  " }).text.length).toBeGreaterThan(0);
  });
});

describe("parseWire", () => {
  it("rejects non JSON and wrong shapes", () => {
    expect(parseWire("not json")).toBeNull();
    expect(parseWire("{\"ok\":true}")).toBeNull();
    expect(parseWire(JSON.stringify(wire()))).toEqual(wire());
  });
});

describe("compileSentence", () => {
  const good = JSON.stringify(wire());
  it("returns a rule on the first good answer", async () => {
    const ask = vi.fn(async () => good);
    const out = await compileSentence("lava on whistle", ask, "id9");
    expect(out).toMatchObject({ ok: true, rule: { id: "id9", mode: "every" } });
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it("re-asks once after a bad answer and tells the model why", async () => {
    const ask = vi.fn<(s: string, n?: string) => Promise<string>>().mockResolvedValueOnce("garbage").mockResolvedValueOnce(good);
    const out = await compileSentence("lava on whistle", ask, "id9");
    expect(out.ok).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][1]).toBeTruthy();
  });
  it("re-asks when the answer parses but can't map to a Rule", async () => {
    const bad = JSON.stringify(wire({ trigger: { type: "touch", sec: 0, target: "none" } }));
    const ask = vi.fn<(s: string, n?: string) => Promise<string>>().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    expect((await compileSentence("x", ask, "a")).ok).toBe(true);
  });
  it("gives the plain error after two bad answers, and stops there", async () => {
    const ask = vi.fn(async () => "garbage");
    expect(await compileSentence("x", ask, "a")).toEqual({ ok: false, status: 422, error: FALLBACK_ERROR });
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("survives the model call throwing once", async () => {
    const ask = vi.fn<(s: string, n?: string) => Promise<string>>().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(good);
    expect((await compileSentence("x", ask, "a")).ok).toBe(true);
  });
  it("says the AI didn't answer when both calls throw", async () => {
    const ask = vi.fn(async (): Promise<string> => { throw new Error("down"); });
    expect(await compileSentence("x", ask, "a")).toMatchObject({ ok: false, status: 502 });
  });
  it("ok=false passes the model's friendly suggestion on, with no re-ask", async () => {
    const ask = vi.fn(async () => JSON.stringify(wire({ ok: false, error: "I can't add jetpacks yet. Try: double speed when I clap" })));
    expect(await compileSentence("jetpack", ask, "a")).toEqual({ ok: false, status: 422, error: "I can't add jetpacks yet. Try: double speed when I clap" });
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it("ok=false with a blank error falls back to the plain error", async () => {
    const ask = async () => JSON.stringify(wire({ ok: false, error: "" }));
    expect(await compileSentence("x", ask, "a")).toMatchObject({ error: FALLBACK_ERROR });
  });
});

describe("wonderRequest", () => {
  it("caps output low, so a runaway answer of blank space fails in seconds and the re-ask comes quickly", () => {
    expect(wonderRequest("m", "double speed").max_output_tokens).toBeLessThanOrEqual(1000);
  });
});
