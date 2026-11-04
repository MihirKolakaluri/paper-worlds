// Camera picking and plain errors. Safari lists an iPhone through Continuity Camera; Chrome did not when tested.

export type Cam = { deviceId: string; label: string };
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const KEY = "pw-camera";
const PHONE = /i ?phone|continuity|desk view/i;
const browserStore = (): Store | null => { try { return window.localStorage; } catch { return null; } };

export function loadCameraId(store: Store | null = browserStore()): string | null {
  try { return store?.getItem(KEY) ?? null; } catch { return null; }
}
export function saveCameraId(id: string, store: Store | null = browserStore()) {
  try { store?.setItem(KEY, id); } catch { /* private mode: we just forget the choice */ }
}

/** The remembered camera if it is still plugged in, else the iPhone, else the first one. */
export function chooseCamera(cams: Cam[], remembered: string | null): string | null {
  if (remembered && cams.some(c => c.deviceId === remembered)) return remembered;
  return (cams.find(c => PHONE.test(c.label) && !/desk/i.test(c.label)) ?? cams.find(c => PHONE.test(c.label)) ?? cams[0])?.deviceId ?? null;
}

export function iphoneHint(cams: Cam[], ua: string): string | null {
  if (cams.some(c => PHONE.test(c.label))) return null;
  const notSafari = /chrome|chromium|crios|edg|firefox/i.test(ua);
  return "No iPhone listed? Open Continuity Camera: iPhone near Mac, same Apple ID." + (notSafari ? " Safari sees the iPhone and Chrome did not, so use Safari if it still doesn't show." : " Locking the iPhone helps it show up.");
}

export function cameraError(e: unknown): string {
  switch ((e as { name?: string } | null)?.name) {
    case "NotAllowedError": case "SecurityError": return "The camera is blocked. Allow it in the address bar, then try again.";
    case "NotFoundError": case "OverconstrainedError": case "NotSupportedError": return "No camera found. Plug one in, or open Continuity Camera: iPhone near Mac, same Apple ID.";
    case "NotReadableError": case "AbortError": return "Another app is using that camera. Close it and try again.";
    default: return "The camera didn't start. Try again, or pick another one.";
  }
}

/** Asks for permission first, as labels stay empty until the browser has it. */
export async function listCameras(): Promise<Cam[]> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no mediaDevices"), { name: "SecurityError" });
  const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
  tmp.getTracks().forEach(t => t.stop());
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter(d => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, frameRate: { ideal: 60 } } });
}
