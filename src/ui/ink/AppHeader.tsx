import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { colors } from './theme.js';

interface AppHeaderProps {
  model: string;
  provider: string;
  branch: string;
  cwd: string;
  version: string;
}

export function AppHeader({ model, provider, branch, cwd, version }: AppHeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  const branchPart = branch ? `  \uE0A0 ${branch}` : '';
  const right = `${model}  ·  ${provider}`;
  const gap = Math.max(1, cols - cwd.length - branchPart.length - right.length - 4);

  return (
    <Box flexDirection="column" width="100%">
      {/* ─── separator ─── */}
      <Box>
        <Text color={colors.accent}>{'─'.repeat(Math.max(0, cols))}</Text>
      </Box>
      {/* ─── title row ─── */}
      <Box paddingX={1}>
        <Text bold color={colors.brand}>
          iCopilot CLI
        </Text>
        <Text color={colors.muted}>{'  v' + version + '  ·  '}</Text>
        <Text bold>{model}</Text>
        <Text color={colors.muted}>{'  ·  '}</Text>
        <Text color={colors.brand}>{provider}</Text>
        <Text>{' '.repeat(Math.max(0, gap))}</Text>
      </Box>
      {/* ─── cwd + branch row ─── */}
      <Box paddingX={1}>
        <Text color={colors.muted}>{cwd}</Text>
        {branch ? <Text color={colors.muted}>{branchPart}</Text> : null}
      </Box>
      {/* ─── hints row ─── */}
      <Box paddingX={1}>
        <Text dimColor>
          {'/help'}
        </Text>
        <Text dimColor color={colors.muted}>{' commands · '}</Text>
        <Text dimColor>{'@file'}</Text>
        <Text dimColor color={colors.muted}>{' context · '}</Text>
        <Text dimColor>{'Ctrl+C'}</Text>
        <Text dimColor color={colors.muted}>{' quit'}</Text>
      </Box>
      {/* ─── separator ─── */}
      <Box>
        <Text color={colors.accent}>{'─'.repeat(Math.max(0, cols))}</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}
