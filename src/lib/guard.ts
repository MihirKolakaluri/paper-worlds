// Cost guards for every /api route. Counters live in memory (per server instance), so they reset on
// cold starts and are not shared across instances. The kill switch env var is the hard stop.

const HOUR = 3_600_000;

/** A separate pot of calls. Each one has its own per-IP hour and its own daily cap; the kill switch stops them all. */
export type Budget = { name: string; perHour: number; capEnv: "DAILY_CAP" | "FIND_DAILY_CAP"; cap: number; busy: string; capped: string };

export const DEFAULT_BUDGET: Budget = {
  name: "default", perHour: 60, capEnv: "DAILY_CAP", cap: 300,
  busy: "That's a lot of levels! Wait a bit and try again.",
  capped: "We hit today's limit. Try the demo level, it works without the AI.",
};

// Sticky notes re-anchor on a timer during play, so one player makes far more calls than a level read.
// With notes behaving the client backs off to one call per 30 s (see callsInFirstHour in reanchor.ts).
export const FIND_BUDGET: Budget = {
  name: "find-objects", perHour: 300, capEnv: "FIND_DAILY_CAP", cap: 1500,
  busy: "Sticky notes need a short rest. Your platforms keep working.",
  capped: "Sticky notes hit today's limit. The level still plays without them.",
};

const ipHits = new Map<string, number[]>();
let day = "";
const dayCounts = new Map<string, number>();

export type GuardResult = { ok: true } | { ok: false; status: number; message: string; retryAfter?: number };

type GuardEnv = { DEMO_KILL_SWITCH?: string; DAILY_CAP?: string; FIND_DAILY_CAP?: string };
export function checkGuard(ip: string, now = Date.now(), env: GuardEnv = process.env as GuardEnv, budget: Budget = DEFAULT_BUDGET): GuardResult {
  if (env.DEMO_KILL_SWITCH === "1") {
    return { ok: false, status: 503, message: "Paper Worlds is resting right now. Try the demo level instead." };
  }
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCounts.clear(); }
  const cap = Number(env[budget.capEnv] ?? budget.cap) || budget.cap;
  const used = dayCounts.get(budget.name) ?? 0;
  if (used >= cap) return { ok: false, status: 503, message: budget.capped };
  const key = `${budget.name}|${ip}`;
  const hits = (ipHits.get(key) ?? []).filter(t => now - t < HOUR);
  if (hits.length >= budget.perHour) {
    return { ok: false, status: 429, message: budget.busy, retryAfter: Math.ceil((hits[0] + HOUR - now) / 1000) };
  }
  hits.push(now);
  ipHits.set(key, hits);
  dayCounts.set(budget.name, used + 1);
  return { ok: true };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Wrap a route handler: runs the guard first and answers with a plain JSON error when it trips. */
export function guarded(handler: (req: Request) => Promise<Response>, budget: Budget = DEFAULT_BUDGET) {
  return async (req: Request) => {
    const g = checkGuard(clientIp(req), Date.now(), process.env as GuardEnv, budget);
    if (!g.ok) return Response.json({ error: g.message }, { status: g.status, headers: g.retryAfter ? { "Retry-After": String(g.retryAfter) } : undefined });
    return handler(req);
  };
}

export function _resetGuardForTests() { ipHits.clear(); day = ""; dayCounts.clear(); }
