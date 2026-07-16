import { Box, Text } from "ink";
import { useTerminalSize } from "./useTerminalSize.js";

const ART = [
  "████████  ██████  ██   ██ ███████",
  "   ██    ██    ██ ██  ██      ██  ",
  "   ██    ██    ██ █████     ██    ",
  "   ██    ██    ██ ██  ██   ██     ",
  "   ██     ██████  ██   ██ ███████ ",
];

export function Banner({ subtitle }: { subtitle?: string }) {
  const { cols, rows } = useTerminalSize();
  const tiny = cols < 40 || rows < 18;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {tiny ? (
        <Text color="cyan" bold>
          ▐ TOKZ ▌
        </Text>
      ) : (
        ART.map((line, i) => (
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))
      )}
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
    </Box>
  );
}
