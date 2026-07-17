import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableStatusline, enableStatusline, statusline, STATUSLINE_COMMAND } from "../src/statusline.js";

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "tokz-sl-"));
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

describe("statusline render", () => {
  const base = {
    session_id: "s",
    transcript_path: "/nope/none.jsonl", // no transcript -> no today/block noise
    model: { id: "claude-fable-5", display_name: "Fable 5" },
    effort: { level: "high" },
    cost: { total_cost_usd: 0.23 },
    context_window: { total_input_tokens: 52_000, total_output_tokens: 3800, context_window_size: 200_000 },
  };

  it("renders model+effort, session cost from stdin, context from context_window", async () => {
    const out = stripAnsi(await statusline(base, Date.parse("2026-07-17T12:00:00Z"), freshHome()));
    expect(out).toContain("🤖 Fable 5 (high)");
    expect(out).toContain("$0.23 session");
    expect(out).toContain("$0.00 today"); // no transcripts in fresh home
    expect(out).toContain("No active block");
    // 52,000 / 200,000 = 26%
    expect(out).toContain("🧠 52.0k (26%)");
  });

  it("cost-source both shows the Claude Code and token-based costs side by side", async () => {
    const out = stripAnsi(
      await statusline(base, Date.parse("2026-07-17T12:00:00Z"), freshHome(), { costSource: "both" }),
    );
    expect(out).toContain("($0.23 cc / $0.00 calc) session");
  });

  it("omits effort and context when Claude Code doesn't send them", async () => {
    const out = stripAnsi(
      await statusline(
        { model: { display_name: "Opus 4.1" }, cost: { total_cost_usd: 0 } },
        Date.parse("2026-07-17T12:00:00Z"),
        freshHome(),
      ),
    );
    expect(out).toContain("🤖 Opus 4.1");
    expect(out).not.toContain("(");
    expect(out).not.toContain("🧠");
  });
});

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
