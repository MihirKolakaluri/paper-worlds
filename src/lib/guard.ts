// Cost guards for every /api route. Counters live in memory (per server instance), so they reset on
// cold starts and are not shared across instances. The kill switch env var is the hard stop.

const HOUR = 3_600_000;
const PER_IP_PER_HOUR = 20;

const ipHits = new Map<string, number[]>();
let day = "";
let dayCount = 0;

export type GuardResult = { ok: true } | { ok: false; status: number; message: string };

type GuardEnv = { DEMO_KILL_SWITCH?: string; DAILY_CAP?: string };
export function checkGuard(ip: string, now = Date.now(), env: GuardEnv = process.env as GuardEnv): GuardResult {
  if (env.DEMO_KILL_SWITCH === "1") {
    return { ok: false, status: 503, message: "Paper Worlds is resting right now. Try the demo level instead." };
  }
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  const cap = Number(env.DAILY_CAP ?? 300) || 300;
  if (dayCount >= cap) {
    return { ok: false, status: 503, message: "We hit today's limit. Try the demo level, it works without the AI." };
  }
  const hits = (ipHits.get(ip) ?? []).filter(t => now - t < HOUR);
  if (hits.length >= PER_IP_PER_HOUR) {
    return { ok: false, status: 429, message: "That's a lot of levels! Wait a bit and try again." };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  dayCount++;
  return { ok: true };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Wrap a route handler: runs the guard first and answers with a plain JSON error when it trips. */
export function guarded(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const g = checkGuard(clientIp(req));
    if (!g.ok) return Response.json({ error: g.message }, { status: g.status });
    return handler(req);
  };
}

export function _resetGuardForTests() { ipHits.clear(); day = ""; dayCount = 0; }
