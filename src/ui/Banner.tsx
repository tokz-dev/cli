import { Box, Text } from "ink";

const ART = [
  "████████  ██████  ██   ██ ███████",
  "   ██    ██    ██ ██  ██      ██  ",
  "   ██    ██    ██ █████     ██    ",
  "   ██    ██    ██ ██  ██   ██     ",
  "   ██     ██████  ██   ██ ███████ ",
];

export function Banner({ subtitle }: { subtitle?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {ART.map((line, i) => (
        <Text key={i} color="cyan" bold>
          {line}
        </Text>
      ))}
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
    </Box>
  );
}
