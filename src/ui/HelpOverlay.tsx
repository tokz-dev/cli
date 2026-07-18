import { Box, Text } from "ink";

const KEYS: [string, string][] = [
  ["↑ ↓", "move selection"],
  ["⏎", "open / select"],
  ["← → or 1–6", "switch dashboard tab"],
  ["/", "filter project list (esc clears)"],
  ["s", "cycle project sort: cost · recent · name"],
  ["t", "cycle timeframe: today · yesterday · 7d · 30d"],
  ["g", "Activity tab: group by day · week · month"],
  ["esc", "go back"],
  ["?", "toggle this help"],
  ["q", "quit"],
];

export function HelpOverlay() {
  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1} alignSelf="center">
      <Text bold color="cyan">
        Keyboard shortcuts
      </Text>
      <Text> </Text>
      {KEYS.map(([key, desc]) => (
        <Text key={key}>
          <Text color="cyan" bold>
            {key.padEnd(14)}
          </Text>
          <Text>{desc}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>All data is read locally from ~/.claude — nothing leaves this machine.</Text>
    </Box>
  );
}
