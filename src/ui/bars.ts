export interface BarRow {
  label: string;
  value: number;
}

export function bar(value: number, max: number, width = 20): string {
  if (max <= 0 || value <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((value / max) * width)));
}

export function bars(rows: BarRow[], width = 20): string[] {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const labelW = Math.max(0, ...rows.map((r) => r.label.length));
  return rows.map((r) => `${r.label.padEnd(labelW)} ${bar(r.value, max, width)}`);
}
