import { describe, it, expect } from "vitest";
import { compact, duration, pct, relativeDate, shortModel } from "../src/format.js";

describe("format", () => {
  it("compacts token counts", () => {
    expect(compact(42)).toBe("42");
    expect(compact(1_234)).toBe("1.2k");
    expect(compact(5_600_000)).toBe("5.6M");
    expect(compact(2_500_000_000)).toBe("2.5B");
  });

  it("formats percentages", () => {
    expect(pct(0.905)).toBe("91%");
    expect(pct(0)).toBe("0%");
  });

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
