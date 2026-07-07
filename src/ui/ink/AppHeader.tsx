import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { colors } from './theme.js';

export type TuiMode = 'ask' | 'plan' | 'autopilot';

interface AppHeaderProps {
  model: string;
  provider: string;
  branch: string;
  cwd: string;
  version: string;
  mode: TuiMode;
}

export function AppHeader({
  model,
  provider,
  branch,
  cwd,
  version,
  mode,
}: AppHeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  const branchPart = branch ? `  \uE0A0 ${branch}` : '';
  const modeColor = mode === 'autopilot' ? colors.warning : mode === 'plan' ? colors.brand : colors.success;

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text color={colors.accent}>{'─'.repeat(cols)}</Text>
      </Box>
      <Box paddingX={1}>
        <Text bold color={colors.brand}>iCopilot CLI</Text>
        <Text color={colors.muted}>{`  v${version}  ·  `}</Text>
        <Text bold>{model}</Text>
        <Text color={colors.muted}>{'  ·  '}</Text>
        <Text color={colors.brand}>{provider}</Text>
        <Text color={colors.muted}>{'  ·  '}</Text>
        <Text bold color={modeColor}>{`[${mode}]`}</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.muted}>{cwd}</Text>
        {branch ? <Text color={colors.muted}>{branchPart}</Text> : null}
      </Box>
      <Box paddingX={1}>
        <Text dimColor color={colors.slash}>/help</Text>
        <Text dimColor color={colors.muted}>{' commands · '}</Text>
        <Text dimColor color={colors.slash}>@file</Text>
        <Text dimColor color={colors.muted}>{' context · '}</Text>
        <Text dimColor color={colors.muted}>{'Shift+Tab mode · '}</Text>
        <Text dimColor color={colors.muted}>{'Ctrl+T think · '}</Text>
        <Text dimColor color={colors.muted}>Ctrl+C quit</Text>
      </Box>
      <Box>
        <Text color={colors.accent}>{'─'.repeat(cols)}</Text>
      </Box>
      <Box><Text> </Text></Box>
    </Box>
  );
}
