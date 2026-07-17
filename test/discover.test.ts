import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeProjectPath, findTranscripts } from "../src/discover.js";

describe("discover", () => {
  it("sanitizes paths the way Claude Code names project dirs", () => {
    // Must match Claude Code's own dir-naming exactly or we find no transcripts.
    expect(sanitizeProjectPath("C:\\Users\\ASUS\\Documents\\proj")).toBe("C--Users-ASUS-Documents-proj");
    expect(sanitizeProjectPath("/home/me/my.app")).toBe("-home-me-my-app");
  });

  it("finds only jsonl transcripts under the project dir", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-home-"));
    const projDir = join(home, ".claude", "projects", "-home-me-proj");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "a.jsonl"), "");
    writeFileSync(join(projDir, "ignore.txt"), "");

    const found = await findTranscripts("/home/me/proj", home);
    expect(found).toHaveLength(1);
    expect(found[0].endsWith("a.jsonl")).toBe(true);
  });
});
