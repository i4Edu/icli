import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type MessageRole = 'user' | 'copilot' | 'error' | 'info' | 'system';

export interface HistoryMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;  // optional thinking/reasoning text from the model
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
  showReasoning: boolean;
}

export function HistoryItem({
  message,
  terminalWidth,
  showReasoning,
}: HistoryItemProps): React.ReactElement {
  const hasReasoning = message.role === 'copilot' && Boolean(message.reasoning);

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <Box>
        <Text color={colors.separator}>{'─'.repeat(terminalWidth)}</Text>
      </Box>
      <Box paddingX={1}>
        <SpeakerLabel role={message.role} />
      </Box>

      {/* Reasoning block — only for copilot messages with reasoning content */}
      {hasReasoning && !showReasoning && (
        <Box paddingX={2} paddingBottom={0}>
          <Text color={colors.accent}>{'▶ '}</Text>
          <Text dimColor>{'Thinking… '}</Text>
          <Text dimColor color={colors.muted}>{'(Ctrl+T to expand)'}</Text>
        </Box>
      )}
      {hasReasoning && showReasoning && (
        <Box flexDirection="column" paddingX={2} paddingBottom={1} borderStyle="single" borderColor={colors.accent} borderLeft={true} borderRight={false} borderTop={false} borderBottom={false}>
          <Box>
            <Text color={colors.accent}>{'▼ '}</Text>
            <Text dimColor bold>{'Thinking'}</Text>
            <Text dimColor>{' (Ctrl+T to collapse)'}</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text dimColor>{message.reasoning}</Text>
          </Box>
        </Box>
      )}

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
