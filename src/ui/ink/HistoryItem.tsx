import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type MessageRole = 'user' | 'copilot' | 'error' | 'info' | 'system';

export interface HistoryMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;  // optional thinking/reasoning text from the model
  model?: string;      // model that generated this response
}

function SpeakerLabel({ role, model }: { role: MessageRole; model?: string }): React.ReactElement {
  switch (role) {
    case 'user':
      return (
        <Box>
          <Text bold color={colors.user}>{'You'}</Text>
        </Box>
      );
    case 'copilot':
      return (
        <Box>
          <Text bold color={colors.copilot}>{'● Copilot'}</Text>
          {model && <Text color={colors.muted}>{`  (${model})`}</Text>}
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
  turnNum?: number;
}

export function HistoryItem({
  message,
  terminalWidth,
  showReasoning,
  turnNum,
}: HistoryItemProps): React.ReactElement {
  const hasReasoning = message.role === 'copilot' && Boolean(message.reasoning);
  const isUser = message.role === 'user';

  // Separator line with optional turn number
  const sepLabel = turnNum != null ? `#${turnNum}` : '';
  const sepLineLen = Math.max(0, terminalWidth - sepLabel.length);

  return (
    <Box flexDirection="column" width={terminalWidth}>
      {/* Separator with turn number */}
      <Box>
        {sepLabel ? (
          <>
            <Text color={colors.separator}>{'─'.repeat(Math.max(0, sepLineLen - 1))}</Text>
            <Text color={colors.muted} dimColor>{sepLabel}</Text>
          </>
        ) : (
          <Text color={colors.separator}>{'─'.repeat(terminalWidth)}</Text>
        )}
      </Box>

      {/* Speaker label */}
      <Box paddingX={1}>
        <SpeakerLabel role={message.role} model={message.model} />
      </Box>

      {/* User messages: indented with left border */}
      {isUser && message.content ? (
        <Box paddingX={2} paddingBottom={1} borderStyle="single" borderColor={colors.user} borderLeft={true} borderRight={false} borderTop={false} borderBottom={false}>
          <Text color={colors.user}>{message.content}</Text>
        </Box>
      ) : null}

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

      {/* Copilot/error/info message content */}
      {!isUser && message.content ? (
        <Box paddingX={2} paddingBottom={1}>
          <Text color={message.role === 'error' ? colors.error : undefined}>
            {message.content}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
