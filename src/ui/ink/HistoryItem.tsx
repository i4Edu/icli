import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type MessageRole = 'user' | 'copilot' | 'error' | 'info' | 'system';

export interface HistoryMessage {
  id: string;
  role: MessageRole;
  content: string;
}

function SpeakerLabel({ role }: { role: MessageRole }): React.ReactElement {
  switch (role) {
    case 'user':
      return <Text bold color={colors.user}>You</Text>;
    case 'copilot':
      return (
        <Box>
          <Text bold color={colors.copilot}>{'● '}</Text>
          <Text bold>Copilot</Text>
        </Box>
      );
    case 'error':
      return <Text bold color={colors.error}>{'✖ Error'}</Text>;
    case 'info':
      return <Text color={colors.muted}>{'ℹ  Info'}</Text>;
    case 'system':
      return <Text color={colors.muted}>{'⏱ System'}</Text>;
  }
}

interface HistoryItemProps {
  message: HistoryMessage;
  terminalWidth: number;
}

export function HistoryItem({
  message,
  terminalWidth,
}: HistoryItemProps): React.ReactElement {
  return (
    <Box flexDirection="column" width={terminalWidth}>
      <Box>
        <Text color={colors.separator}>{'─'.repeat(terminalWidth)}</Text>
      </Box>
      <Box paddingX={1}>
        <SpeakerLabel role={message.role} />
      </Box>
      {message.content ? (
        <Box paddingX={2} paddingBottom={1}>
          <Text color={message.role === 'error' ? colors.error : undefined}>
            {message.content}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
