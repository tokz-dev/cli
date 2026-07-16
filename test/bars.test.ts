import { describe, it, expect } from "vitest";
import { bar, bars } from "../src/ui/bars.js";

describe("bar", () => {
  it("fills proportionally to max, min one block for nonzero, empty for zero", () => {
    expect(bar(10, 10, 10)).toBe("█".repeat(10));
    expect(bar(5, 10, 10)).toBe("█".repeat(5));
    expect(bar(0, 10, 10)).toBe("");
    expect(bar(1, 1000, 10)).toBe("█"); // rounds to 0 but clamped to 1
    expect(bar(5, 0, 10)).toBe(""); // max 0 -> empty, no divide-by-zero
  });
});

describe("bars", () => {
  it("pads labels to equal width and scales each row", () => {
    const out = bars([
      { label: "a", value: 10 },
      { label: "bbb", value: 5 },
    ], 10);
    expect(out[0]).toBe("a   " + "█".repeat(10));
    expect(out[1]).toBe("bbb " + "█".repeat(5));
  });
});
