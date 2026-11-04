import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/read-level/route";
import { _resetGuardForTests } from "@/lib/guard";

describe("read-level", () => {
  it("answers a broken request body with a plain error, not a crash", async () => {
    _resetGuardForTests();
    const res = await POST(new Request("http://x/api/read-level", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
