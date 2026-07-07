import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from './theme.js';

interface SplashBannerProps {
  onDone: () => void;
  cols: number;
  rows: number;
  version: string;
}

const TIPS = [
  'Type @ to mention files',
  'Type / for commands',
  'Shift+Tab to change mode',
];

export function SplashBanner({ onDone, cols, rows, version }: SplashBannerProps): React.ReactElement {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  useInput(() => onDone());

  const centerWidth = Math.min(cols, 60);

  return (
    <Box
      width={cols}
      height={rows}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor={colors.accent}
        paddingX={4}
        paddingY={1}
        width={centerWidth}
      >
        <Text bold color={colors.accent}>{'iCopilot'}</Text>
        <Text color={colors.brand}>{`v${version}  ·  AI coding assistant for your terminal`}</Text>

        <Box marginTop={1} flexDirection="column" alignItems="center">
          {TIPS.map(tip => (
            <Text key={tip} color={colors.muted}>{`  ✦  ${tip}`}</Text>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color={colors.muted} dimColor>{'Press any key to continue…'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
