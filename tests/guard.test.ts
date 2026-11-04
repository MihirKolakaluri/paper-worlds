import { beforeEach, describe, expect, it } from "vitest";
import { _resetGuardForTests, checkGuard, FIND_BUDGET, guarded } from "@/lib/guard";
import { callsInFirstHour } from "@/tracking/reanchor";

describe("guard", () => {
  beforeEach(() => _resetGuardForTests());
  it("kill switch returns a plain 503", () => {
    const g = checkGuard("1.1.1.1", Date.now(), { DEMO_KILL_SWITCH: "1" });
    expect(g).toMatchObject({ ok: false, status: 503 });
  });
  it("limits one IP to 20 calls an hour", () => {
    const t = Date.UTC(2026, 10, 1, 12);
    for (let i = 0; i < 20; i++) expect(checkGuard("2.2.2.2", t + i, {}).ok).toBe(true);
    expect(checkGuard("2.2.2.2", t + 21, {})).toMatchObject({ ok: false, status: 429 });
    expect(checkGuard("3.3.3.3", t + 22, {}).ok).toBe(true);
    expect(checkGuard("2.2.2.2", t + 3_600_100, {}).ok).toBe(true);
  });
  it("stops everyone at the daily cap and resets the next day", () => {
    const t = Date.UTC(2026, 10, 1, 12);
    for (let i = 0; i < 5; i++) expect(checkGuard(`ip${i}`, t, { DAILY_CAP: "5" }).ok).toBe(true);
    expect(checkGuard("ip9", t, { DAILY_CAP: "5" })).toMatchObject({ ok: false, status: 503 });
    expect(checkGuard("ip9", t + 86_400_000, { DAILY_CAP: "5" }).ok).toBe(true);
  });
});

describe("find-objects budget", () => {
  beforeEach(() => _resetGuardForTests());
  const t = Date.UTC(2026, 10, 1, 12);

  it("gives find-objects its own per-IP hour, so re-anchoring can't eat level reads", () => {
    for (let i = 0; i < FIND_BUDGET.perHour; i++) expect(checkGuard("4.4.4.4", t + i, {}, FIND_BUDGET).ok).toBe(true);
    expect(checkGuard("4.4.4.4", t + 1000, {}, FIND_BUDGET)).toMatchObject({ ok: false, status: 429 });
    expect(checkGuard("4.4.4.4", t + 1001, {}).ok).toBe(true); // level reads still work
    expect(checkGuard("5.5.5.5", t + 1002, {}, FIND_BUDGET).ok).toBe(true); // other people still work
    expect(checkGuard("4.4.4.4", t + 3_600_100, {}, FIND_BUDGET).ok).toBe(true); // and it refills
  });
  it("says how long to wait when the hour runs out", () => {
    for (let i = 0; i < FIND_BUDGET.perHour; i++) checkGuard("4.4.4.4", t, {}, FIND_BUDGET);
    expect(checkGuard("4.4.4.4", t + 600_000, {}, FIND_BUDGET)).toMatchObject({ ok: false, retryAfter: 3000 });
  });
  it("still has a daily cap, and it doesn't touch the one for level reads", () => {
    const env = { FIND_DAILY_CAP: "3", DAILY_CAP: "5" };
    for (let i = 0; i < 3; i++) expect(checkGuard(`f${i}`, t, env, FIND_BUDGET).ok).toBe(true);
    expect(checkGuard("f9", t, env, FIND_BUDGET)).toMatchObject({ ok: false, status: 503 });
    expect(checkGuard("r1", t, env).ok).toBe(true);
    expect(checkGuard("f9", t + 86_400_000, env, FIND_BUDGET).ok).toBe(true);
  });
  it("the kill switch stops it too", () => {
    expect(checkGuard("6.6.6.6", t, { DEMO_KILL_SWITCH: "1" }, FIND_BUDGET)).toMatchObject({ ok: false, status: 503 });
  });
  it("an hour of play with a backed-off re-anchor fits the budget with room to spare", () => {
    expect(callsInFirstHour()).toBeLessThan(FIND_BUDGET.perHour * 0.75);
  });
  it("guarded() answers 429 with Retry-After and doesn't run the handler", async () => {
    for (let i = 0; i < FIND_BUDGET.perHour; i++) checkGuard("7.7.7.7", Date.now(), {}, FIND_BUDGET);
    let ran = false;
    const route = guarded(async () => { ran = true; return new Response("ok"); }, FIND_BUDGET);
    const res = await route(new Request("http://x/", { headers: { "x-forwarded-for": "7.7.7.7" } }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(ran).toBe(false);
  });
});
