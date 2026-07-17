import { describe, it, expect } from "vitest";
import { windowOffset } from "../src/ui/viewport.js";

describe("windowOffset", () => {
  it("returns 0 when everything fits", () => {
    expect(windowOffset(0, 5, 10)).toBe(0);
    expect(windowOffset(4, 5, 10)).toBe(0);
  });

  it("keeps the cursor centered while scrolling and clamps at both ends", () => {
    // 40 rows, window of 20
    expect(windowOffset(0, 40, 20)).toBe(0); // top: no scroll past 0
    expect(windowOffset(15, 40, 20)).toBe(5); // centered: 15 - 10
    expect(windowOffset(39, 40, 20)).toBe(20); // bottom: clamp to count - height
  });

  it("always keeps the cursor within the visible window", () => {
    const count = 100;
    const height = 12;
    for (let cursor = 0; cursor < count; cursor++) {
      const off = windowOffset(cursor, count, height);
      expect(cursor).toBeGreaterThanOrEqual(off);
      expect(cursor).toBeLessThan(off + height);
    }
  });
});
