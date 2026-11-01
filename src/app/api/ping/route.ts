import { guarded } from "@/lib/guard";

export const maxDuration = 60;

// Cheap guarded route: proves the guard and kill switch work on the live deploy. No model call.
export const GET = guarded(async () => Response.json({ ok: true }));
