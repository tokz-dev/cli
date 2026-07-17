import { Box, Text } from "ink";
import { useTerminalSize } from "./useTerminalSize.js";

const ART = [
  "████████  ██████  ██   ██ ███████",
  "   ██    ██    ██ ██  ██      ██  ",
  "   ██    ██    ██ █████     ██    ",
  "   ██    ██    ██ ██  ██   ██     ",
  "   ██     ██████  ██   ██ ███████ ",
];

/** "full" = ascii art + subtitle + margin (7 rows), "tiny" = wordmark + subtitle
 *  + margin (3 rows), "none" = nothing. Callers with a tight height budget pass
 *  an explicit mode; otherwise it's chosen from the terminal size. */
export type BannerMode = "full" | "tiny" | "none";

export function bannerHeight(mode: BannerMode): number {
  return mode === "full" ? 7 : mode === "tiny" ? 3 : 0;
}

export function Banner({ subtitle, mode }: { subtitle?: string; mode?: BannerMode }) {
  const { cols, rows } = useTerminalSize();
  const resolved: BannerMode = mode ?? (cols < 40 || rows < 18 ? "tiny" : "full");
  if (resolved === "none") return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {resolved === "tiny" ? (
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
