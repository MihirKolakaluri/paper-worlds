import { Level } from "@/schema/level";

// Keeps the current level between the snap page and the play page.
// Memory first; sessionStorage as a backup so a reload on /play still works.
let current: Level | null = null;
const KEY = "pw-level";

export function saveLevel(l: Level) {
  current = l;
  try { sessionStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage full or blocked: memory still works */ }
}
export function loadLevel(): Level | null {
  if (current) return current;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) { const p = Level.safeParse(JSON.parse(raw)); if (p.success) return (current = p.data); }
  } catch { /* ignore */ }
  return null;
}
