import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type MessageRole = 'user' | 'copilot' | 'error' | 'info' | 'system';

export interface HistoryMessage {
  id: string;
  role: MessageRole;
  content: string;
}

interface HistoryItemProps {
  message: HistoryMessage;
  terminalWidth: number;
}

function SpeakerLabel({ role }: { role: MessageRole }): React.ReactElement {
  switch (role) {
    case 'user':
      return <Text bold color={colors.user}>You</Text>;
    case 'copilot':
      return (
        <Box>
          <Text bold color={colors.copilot}>● </Text>
          <Text bold>Copilot</Text>
        </Box>
      );
    case 'error':
      return <Text bold color={colors.error}>✖ Error</Text>;
    case 'info':
      return <Text color={colors.muted}>ℹ Info</Text>;
    case 'system':
      return <Text color={colors.muted}>⏱ System</Text>;
  }
}

export function HistoryItem({ message, terminalWidth }: HistoryItemProps): React.ReactElement {
  const isUser = message.role === 'user';

  return (
    <Box flexDirection="column" width={terminalWidth}>
      {/* separator above each item */}
      <Box>
        <Text color={colors.separator}>{'─'.repeat(Math.max(0, terminalWidth))}</Text>
      </Box>
      {/* speaker label */}
      <Box paddingX={1} paddingTop={0}>
        <SpeakerLabel role={message.role} />
      </Box>
      {/* content */}
      <Box paddingX={isUser ? 1 : 1} paddingBottom={1}>
        {message.role === 'error' ? (
          <Text color={colors.error}>{message.content}</Text>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
}
