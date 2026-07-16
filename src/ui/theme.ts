export const theme = {
  accent: "cyan",
  good: "green",
  bad: "red",
  warn: "yellow",
  mcp: "magenta",
} as const;

const MODEL_COLORS: [string, string][] = [
  ["fable", "magenta"],
  ["opus", "cyan"],
  ["sonnet", "blue"],
  ["haiku", "green"],
];

export function modelColor(modelId: string): string {
  for (const [key, color] of MODEL_COLORS) {
    if (modelId.includes(key)) return color;
  }
  return "white";
}
