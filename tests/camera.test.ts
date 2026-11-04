import { describe, expect, it } from "vitest";
import { cameraError, chooseCamera, iphoneHint, loadCameraId, saveCameraId } from "@/tracking/camera";

const cam = (deviceId: string, label: string) => ({ deviceId, label });
const mac = cam("m", "FaceTime HD Camera"), phone = cam("p", "Test iPhone Camera"), desk = cam("d", "iPhone Desk View Camera");
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", SAFARI = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

describe("chooseCamera", () => {
  it("uses the remembered camera if it is still there", () => { expect(chooseCamera([mac, phone], "m")).toBe("m"); });
  it("otherwise prefers the iPhone", () => { expect(chooseCamera([mac, phone], "gone")).toBe("p"); });
  it("falls back to the first camera, or nothing", () => {
    expect(chooseCamera([mac], null)).toBe("m");
    expect(chooseCamera([], null)).toBeNull();
  });
});

describe("remembered camera", () => {
  it("round trips", () => { const s = memory(); saveCameraId("abc", s); expect(loadCameraId(s)).toBe("abc"); });
  it("survives blocked storage", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveCameraId("abc", bad)).not.toThrow();
    expect(loadCameraId(bad)).toBeNull();
  });
});

describe("plain errors", () => {
  const err = (name: string) => Object.assign(new Error("x"), { name });
  it("no permission", () => { expect(cameraError(err("NotAllowedError"))).toMatch(/allow/i); });
  it("no camera", () => { expect(cameraError(err("NotFoundError"))).toMatch(/no camera/i); });
  it("camera busy", () => { expect(cameraError(err("NotReadableError"))).toMatch(/another app/i); });
  it("anything else still reads as a sentence", () => { expect(cameraError(new TypeError("undefined"))).toMatch(/camera/i); });
});

describe("iphoneHint", () => {
  it("is quiet when the iPhone is listed", () => { expect(iphoneHint([mac, desk], SAFARI)).toBeNull(); });
  it("says how to open Continuity Camera", () => { expect(iphoneHint([mac], SAFARI)).toContain("Open Continuity Camera: iPhone near Mac, same Apple ID"); });
  it("tells Chrome users to try Safari", () => {
    expect(iphoneHint([mac], CHROME)).toMatch(/use Safari/i);
    expect(iphoneHint([mac], SAFARI)).not.toMatch(/use Safari/i);
  });
});
