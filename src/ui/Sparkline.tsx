import { Text } from "ink";

const LEVELS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max <= 0) return LEVELS[0].repeat(values.length);
  return values
    .map((v) => LEVELS[v <= 0 ? 0 : Math.min(7, Math.max(1, Math.round((v / max) * 7)))])
    .join("");
}

export function Sparkline({ values, color = "cyan" }: { values: number[]; color?: string }) {
  return <Text color={color}>{sparkline(values)}</Text>;
}
