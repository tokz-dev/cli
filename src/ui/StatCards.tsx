import { Box, Text } from "ink";

export interface Stat {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}

export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <Box flexWrap="wrap">
      {stats.map((s) => (
        <Box
          key={s.label}
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          marginRight={1}
        >
          <Text dimColor>{s.label}</Text>
          <Text bold color={s.color}>
            {s.value}
            {s.hint ? <Text dimColor> {s.hint}</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
