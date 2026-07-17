import { describe, it, expect } from "vitest";
import { duration, relativeDate, shortModel } from "../src/format.js";

// Only the formatters with real branching/regex are worth pinning; pure
// number formatting (compact/pct) is trivial and visibly wrong if it breaks.
describe("format", () => {
  it("shortens model ids", () => {
    expect(shortModel("claude-opus-4-8")).toBe("opus-4-8");
    expect(shortModel("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
    expect(shortModel("weird-model")).toBe("weird-model");
  });

  it("formats durations", () => {
    expect(duration("2026-07-01T10:00:00Z", "2026-07-01T12:30:00Z")).toBe("2h 30m");
    expect(duration("2026-07-01T10:00:00Z", "2026-07-01T10:45:00Z")).toBe("45m");
    expect(duration("2026-07-01T10:00:00Z", "2026-07-01T10:00:10Z")).toBe("<1m");
    expect(duration(undefined, undefined)).toBe("—");
  });

  it("formats relative dates", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    expect(relativeDate("2026-07-16", now)).toBe("today");
    expect(relativeDate("2026-07-15", now)).toBe("yesterday");
    expect(relativeDate("2026-07-10", now)).toBe("6d ago");
    expect(relativeDate("2026-05-01", now)).toBe("2026-05-01");
  });
});
