import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableStatusline, enableStatusline, STATUSLINE_COMMAND } from "../src/statusline.js";

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "tokz-sl-"));
}

describe("statusline enable/disable", () => {
  it("creates settings.json with the hook when none exists", async () => {
    const home = freshHome();
    const msg = await enableStatusline(home);
    expect(msg).toContain("enabled");
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.statusLine).toEqual({ type: "command", command: STATUSLINE_COMMAND });
  });

  it("preserves existing settings and reports a replaced hook", async () => {
    const home = freshHome();
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ model: "opus", statusLine: { type: "command", command: "other-tool" } }),
    );
    const msg = await enableStatusline(home);
    expect(msg).toContain("other-tool");
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.model).toBe("opus");
    expect(settings.statusLine.command).toBe(STATUSLINE_COMMAND);
    expect(await enableStatusline(home)).toContain("Already enabled");
  });

  it("refuses to touch an unparseable settings file", async () => {
    const home = freshHome();
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "{broken");
    await expect(enableStatusline(home)).rejects.toThrow();
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe("{broken");
  });

  it("disable removes only a tokz hook", async () => {
    const home = freshHome();
    await enableStatusline(home);
    expect(await disableStatusline(home)).toContain("disabled");
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.statusLine).toBeUndefined();

    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "other-tool" } }),
    );
    expect(await disableStatusline(home)).toContain("leaving it alone");
    expect(await disableStatusline(freshHome())).toContain("nothing to do");
  });
});
