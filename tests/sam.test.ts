import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { findNotes, parseSamBoxes } from "@/lib/sam";

const raw = JSON.parse(readFileSync("fixtures/sam-sticky-note.json", "utf8"));
const text: string = raw.output[0].content[0].text;

describe("parseSamBoxes", () => {
  it("reads the boxes out of a real SAM answer (640x480 test scene with 2 notes)", () => {
    expect(parseSamBoxes(text, 640, 480)).toEqual([
      { x1: 376, y1: 266, x2: 466, y2: 356 },
      { x1: 188, y1: 128, x2: 275, y2: 213 },
    ]);
  });
  it("treats an empty answer as no notes, not an error", () => {
    expect(parseSamBoxes("", 640, 480)).toEqual([]);
    expect(parseSamBoxes("\n", 640, 480)).toEqual([]);
  });
  it("scales when SAM saw a different size than the caller's image", () => {
    expect(parseSamBoxes("<0f>0<|box;x1=100;y1=50;x2=200;y2=150;w=1000;h=500|>", 500, 250)).toEqual([{ x1: 50, y1: 25, x2: 100, y2: 75 }]);
  });
  it("ignores mask payloads, and junk or empty boxes", () => {
    const t = "<0f>0<|box;x1=10;y1=10;x2=10;y2=40;w=64;h=64|><|mask;x=0;y=0;data=3,3,!abc,1<|>,1<|box;x1=1;y1=2;x2=30;y2=40;w=64;h=64|>,garbage";
    expect(parseSamBoxes(t, 64, 64)).toEqual([{ x1: 1, y1: 2, x2: 30, y2: 40 }]);
  });
  it("clamps boxes to the image", () => {
    expect(parseSamBoxes("<0f>0<|box;x1=10;y1=10;x2=99;y2=99;w=64;h=64|>", 64, 64)).toEqual([{ x1: 10, y1: 10, x2: 63, y2: 63 }]);
  });
});

describe("findNotes", () => {
  it("sends the noun phrase and the frame to SAM and asks for one_bit masks", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: text });
    const boxes = await findNotes("data:image/jpeg;base64,AAAA", 640, 480, { responses: { create } });
    expect(boxes).toHaveLength(2);
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("sam-3.1");
    expect(body.metadata).toEqual({ mask_encoding: "one_bit" });
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "sticky note" });
    expect(body.input[0].content[1].image_url).toBe("data:image/jpeg;base64,AAAA");
  });
});
