/**
 * Scroll a list of `count` rows through a window of `height` rows, keeping the
 * row at `cursor` visible and roughly centered. Returns the first visible index.
 * Pure so it can be unit-tested without rendering.
 */
export function windowOffset(cursor: number, count: number, height: number): number {
  if (count <= height) return 0;
  const centered = cursor - Math.floor(height / 2);
  return Math.max(0, Math.min(centered, count - height));
}
