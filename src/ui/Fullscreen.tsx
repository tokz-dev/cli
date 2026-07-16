import { useEffect, useState } from "react";
import { Box } from "ink";

function size() {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

// Renders children into the alternate screen buffer at full terminal size, so
// redraws never leave leftover rows from a previous, taller frame.
export function Fullscreen({ children }: { children: React.ReactNode }) {
  const [dim, setDim] = useState(size);

  useEffect(() => {
    const tty = process.stdout.isTTY;
    if (tty) process.stdout.write("\x1b[?1049h\x1b[H"); // enter alt buffer, cursor home
    const onResize = () => setDim(size());
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
      if (tty) process.stdout.write("\x1b[?1049l"); // leave alt buffer, restore
    };
  }, []);

  return (
    <Box width={dim.cols} height={dim.rows} flexDirection="column" padding={1}>
      {children}
    </Box>
  );
}
