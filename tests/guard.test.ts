import { beforeEach, describe, expect, it } from "vitest";
import { _resetGuardForTests, checkGuard } from "@/lib/guard";

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
