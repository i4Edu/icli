import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { colors } from './theme.js';

interface ComposerProps {
  value: string;
  busy: boolean;
  model: string;
  branch: string;
  tokenCount: number;
  followups: string[];
  followupIndex: number;
  onSubmit: (line: string) => void;
  onFollowupCycle: (dir: 1 | -1) => void;
  onFollowupClear: () => void;
}

export function Composer({
  value,
  busy,
  model,
  branch,
  tokenCount,
  followups,
  followupIndex,
  onSubmit,
  onFollowupCycle,
  onFollowupClear,
}: ComposerProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;

  useInput((input, key) => {
    if (busy) return;
    if (key.return) {
      if (!value.trim() && followups.length) {
        const idx = ((followupIndex % followups.length) + followups.length) % followups.length;
        onSubmit(followups[idx] ?? '');
        onFollowupClear();
      } else if (value.trim()) {
        onSubmit(value);
      }
    }
    if (key.ctrl && (input === 'n' || input === '\x0e') && followups.length) onFollowupCycle(1);
    if (key.ctrl && (input === 'p' || input === '\x10') && followups.length) onFollowupCycle(-1);
    if (key.escape) onFollowupClear();
  });

  // Followup chips
  const chipsLine =
    followups.length > 0 ? (
      <Box paddingX={1}>
        <Text dimColor>Next:  </Text>
        {followups.map((c, i) => (
          <React.Fragment key={c}>
            {i > 0 && <Text>{'  '}</Text>}
            {i === followupIndex ? (
              <Text bold color={colors.success}>{`[${c}]`}</Text>
            ) : (
              <Text color={colors.muted}>{`[${c}]`}</Text>
            )}
          </React.Fragment>
        ))}
      </Box>
    ) : null;

  const chipsHint =
    followups.length > 0 ? (
      <Box paddingX={1}>
        <Text dimColor>{'↵ run  Ctrl+N/P cycle  Esc dismiss'}</Text>
      </Box>
    ) : null;

  // ▄▄▄ upper separator
  const upperSep = '▄'.repeat(Math.max(0, cols));
  // ▀▀▀ lower separator  
  const lowerSep = '▀'.repeat(Math.max(0, cols));

  // Status footer: workspace · branch · model · tokens
  const tokenPart = tokenCount > 0 ? `  ·  ~${Math.round(tokenCount / 1000)}k ctx` : '';
  const branchPart = branch ? `  \uE0A0 ${branch}` : '';
  const footerRight = `${model}${tokenPart}`;
  const footerLeft = process.cwd().replace(process.env.HOME ?? '', '~');
  const footerGap = Math.max(
    1,
    cols - footerLeft.length - branchPart.length - footerRight.length - 2,
  );

  return (
    <Box flexDirection="column" width="100%">
      {chipsLine}
      {chipsHint}
      {/* ▄▄▄ upper separator */}
      <Box>
        <Text color={colors.accent}>{upperSep}</Text>
      </Box>
      {/* Input row */}
      <Box paddingX={1}>
        {busy ? (
          <Text color={colors.warning}>{'◆ '}</Text>
        ) : (
          <Text bold color={colors.success}>{'❯ '}</Text>
        )}
        <Text>{value}</Text>
        {!busy && <Text inverse>{' '}</Text>}
        {busy && <Text color={colors.muted} dimColor>{' (working…)'}</Text>}
      </Box>
      {/* ▀▀▀ lower separator */}
      <Box>
        <Text color={colors.separator}>{lowerSep}</Text>
      </Box>
      {/* Footer bar: cwd · branch · model · tokens */}
      <Box paddingX={1}>
        <Text color={colors.muted}>{footerLeft}</Text>
        {branch ? <Text color={colors.muted}>{branchPart}</Text> : null}
        <Text>{' '.repeat(Math.max(0, footerGap))}</Text>
        <Text color={colors.muted}>{footerRight}</Text>
      </Box>
    </Box>
  );
}
