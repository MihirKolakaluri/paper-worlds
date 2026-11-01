import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Fails if any tracked or staged image carries EXIF (which can hold GPS location).
function images(): string[] {
  const out = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" });
  return out.split("\n").filter(f => /\.(jpe?g|png)$/i.test(f));
}
function hasExif(buf: Buffer, name: string): boolean {
  if (/\.png$/i.test(name)) return buf.includes(Buffer.from("eXIf"));
  for (let i = 2; i < buf.length - 10; ) { // walk JPEG segments until image data
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 8).toString("latin1") === "Exif") return true;
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return false;
}

describe("images", () => {
  it("carry no EXIF", () => {
    const bad = images().filter(f => hasExif(readFileSync(f), f));
    expect(bad).toEqual([]);
  });
});
