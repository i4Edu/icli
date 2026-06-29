import { PLAN_SYSTEM, getAskSystemPrompt } from './prompts.js';
import { loadMemoryBlock } from '../context/memory.js';
import { loadConventionPromptContext } from '../knowledge/conventions.js';
import { loadStylePromptContext } from '../knowledge/style-learner.js';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { countTokensSync } from '../util/tokens.js';
import { config } from '../config.js';

export interface TokenBreakdown {
  category: string;
  tokens: number;
  percentage: number;
  details?: string;
}

interface TokenSegment {
  tokens: number;
  bytes: number;
}

interface MessageBreakdown {
  index: number;
  role: string;
  tokens: number;
  bytes: number;
  details?: string;
}

const FILE_REF_HEADER = '### Referenced files';

export function tokensCommand(session: Session): string {
  const baseSystemPrompt = session.state.mode === 'plan' ? PLAN_SYSTEM : getAskSystemPrompt();
  const memoryBlock = loadMemoryBlock(session.state.cwd) ?? '';
  const styleBlock = loadStylePromptContext(session.state.cwd) ?? '';
  const conventionBlock = loadConventionPromptContext(session.state.cwd) ?? '';

  const systemPrompt = segmentForText(baseSystemPrompt);
  const stylePrompt = segmentForText(styleBlock);
  const conventionPrompt = segmentForText(conventionBlock);
  const memoryPrompt = segmentForText(memoryBlock);
  const userMessages: TokenSegment = { tokens: 0, bytes: 0 };
  const assistantResponses: TokenSegment = { tokens: 0, bytes: 0 };
  const toolCalls: TokenSegment = { tokens: 0, bytes: 0 };
  const fileRefs: TokenSegment = { tokens: 0, bytes: 0 };
  const messageBreakdowns: MessageBreakdown[] = [];

  let fileRefBlocks = 0;
  let assistantToolCalls = 0;
  let toolMessages = 0;

  for (const [index, message] of session.state.messages.entries()) {
    const role = String(message.role || 'message');
    const content = contentToText((message as { content?: unknown }).content);

    if (role === 'user') {
      const { mainText, refText } = splitFileRefs(content);
      const mainSegment = segmentForText(mainText);
      const refSegment = segmentForText(refText);

      userMessages.tokens += mainSegment.tokens;
      userMessages.bytes += mainSegment.bytes;
      fileRefs.tokens += refSegment.tokens;
      fileRefs.bytes += refSegment.bytes;
      if (refSegment.tokens > 0) fileRefBlocks += 1;

      messageBreakdowns.push({
        index,
        role,
        tokens: mainSegment.tokens + refSegment.tokens,
        bytes: mainSegment.bytes + refSegment.bytes,
        details:
          refSegment.tokens > 0
            ? `${mainSegment.tokens} user + ${refSegment.tokens} refs`
            : `${mainSegment.tokens} user`,
      });
      continue;
    }

    if (role === 'assistant') {
      const contentSegment = segmentForText(content);
      assistantResponses.tokens += contentSegment.tokens;
      assistantResponses.bytes += contentSegment.bytes;

      const toolCallPayload = toolCallsToText((message as { tool_calls?: unknown }).tool_calls);
      const toolCallSegment = segmentForText(toolCallPayload);
      toolCalls.tokens += toolCallSegment.tokens;
      toolCalls.bytes += toolCallSegment.bytes;
      if (toolCallSegment.tokens > 0) assistantToolCalls += 1;

      const totalTokens = contentSegment.tokens + toolCallSegment.tokens;
      const totalBytes = contentSegment.bytes + toolCallSegment.bytes;
      const detailParts: string[] = [];
      if (contentSegment.tokens > 0) detailParts.push(`${contentSegment.tokens} reply`);
      if (toolCallSegment.tokens > 0) detailParts.push(`${toolCallSegment.tokens} tool-call`);
      messageBreakdowns.push({
        index,
        role,
        tokens: totalTokens,
        bytes: totalBytes,
        details: detailParts.join(' + ') || undefined,
      });
      continue;
    }

    if (role === 'tool') {
      const contentSegment = segmentForText(content);
      const toolCallIdSegment = segmentForText(
        typeof (message as { tool_call_id?: unknown }).tool_call_id === 'string'
          ? (message as { tool_call_id: string }).tool_call_id
          : '',
      );

      toolCalls.tokens += contentSegment.tokens + toolCallIdSegment.tokens;
      toolCalls.bytes += contentSegment.bytes + toolCallIdSegment.bytes;
      if (contentSegment.tokens > 0 || toolCallIdSegment.tokens > 0) toolMessages += 1;

      messageBreakdowns.push({
        index,
        role,
        tokens: contentSegment.tokens + toolCallIdSegment.tokens,
        bytes: contentSegment.bytes + toolCallIdSegment.bytes,
        details: `${contentSegment.tokens} result`,
      });
      continue;
    }

    const segment = segmentForText(content);
    if (role === 'system') {
      systemPrompt.tokens += segment.tokens;
      systemPrompt.bytes += segment.bytes;
    }
    messageBreakdowns.push({
      index,
      role,
      tokens: segment.tokens,
      bytes: segment.bytes,
      details: role === 'system' ? `${segment.tokens} persisted system` : undefined,
    });
  }

  const categories: Array<TokenBreakdown & { bytes: number }> = [
    {
      category: 'System prompt',
      tokens: systemPrompt.tokens,
      percentage: 0,
      details: session.state.mode === 'plan' ? 'plan mode prompt' : 'ask mode prompt',
      bytes: systemPrompt.bytes,
    },
    {
      category: 'Style profile',
      tokens: stylePrompt.tokens,
      percentage: 0,
      details: stylePrompt.tokens > 0 ? 'loaded from .icopilot/style-profile.json' : 'none loaded',
      bytes: stylePrompt.bytes,
    },
    {
      category: 'Conventions',
      tokens: conventionPrompt.tokens,
      percentage: 0,
      details:
        conventionPrompt.tokens > 0 ? 'loaded from .icopilot/conventions.yaml' : 'none loaded',
      bytes: conventionPrompt.bytes,
    },
    {
      category: 'User messages',
      tokens: userMessages.tokens,
      percentage: 0,
      details: `${countByRole(session, 'user')} message(s)`,
      bytes: userMessages.bytes,
    },
    {
      category: 'Assistant responses',
      tokens: assistantResponses.tokens,
      percentage: 0,
      details: `${countByRole(session, 'assistant')} message(s)`,
      bytes: assistantResponses.bytes,
    },
    {
      category: 'Tool calls',
      tokens: toolCalls.tokens,
      percentage: 0,
      details: `${assistantToolCalls} assistant call(s), ${toolMessages} tool result(s)`,
      bytes: toolCalls.bytes,
    },
    {
      category: 'File references',
      tokens: fileRefs.tokens,
      percentage: 0,
      details: `${fileRefBlocks} injected block(s)`,
      bytes: fileRefs.bytes,
    },
    {
      category: 'Memory block',
      tokens: memoryPrompt.tokens,
      percentage: 0,
      details:
        memoryPrompt.tokens > 0
          ? 'loaded from .icopilot memory files (including team memory)'
          : 'none loaded',
      bytes: memoryPrompt.bytes,
    },
  ];

  const total = categories.reduce((sum, category) => sum + category.tokens, 0);
  for (const category of categories) {
    category.percentage = total > 0 ? (category.tokens / total) * 100 : 0;
  }

  const totalBytes = categories.reduce((sum, category) => sum + category.bytes, 0);
  const budget = config.contextWindow;
  const remaining = Math.max(0, budget - total);
  const usedPct = budget > 0 ? (total / budget) * 100 : 0;
  const largest = [...categories].sort(
    (a, b) => b.tokens - a.tokens || a.category.localeCompare(b.category),
  )[0];

  const categoryLines = categories.map((category) => {
    const name = category.category.padEnd(20);
    const tokens = theme.hl(String(category.tokens).padStart(6));
    const bytes = theme.dim(formatBytes(category.bytes).padStart(8));
    const details = category.details ? ` ${theme.dim(`(${category.details})`)}` : '';
    const badge =
      largest && largest.category === category.category && category.tokens > 0
        ? ` ${theme.ok('← largest')}`
        : '';
    return `  ${name} ${tokens} tk  ${renderTokenBar(category.tokens, total, 18)}  ${bytes}${details}${badge}`;
  });

  const messageLines =
    messageBreakdowns.length > 0
      ? messageBreakdowns.map((entry) => {
          const label = `#${entry.index} ${entry.role}`.padEnd(16);
          const details = entry.details ? ` ${theme.dim(`(${entry.details})`)}` : '';
          return `  ${label} ${theme.hl(String(entry.tokens).padStart(6))} tk  ${theme.dim(
            formatBytes(entry.bytes).padStart(8),
          )}${details}`;
        })
      : [`  ${theme.dim('No persisted messages.')}`];

  return [
    theme.brand('Token analysis'),
    `  budget:    ${theme.hl(String(budget))} tk`,
    `  used:      ${theme.hl(String(total))} tk  ${renderTokenBar(total, budget, 24)}  ${theme.dim(formatBytes(totalBytes))}`,
    `  remaining: ${remaining > 0 ? theme.ok(String(remaining)) : theme.err(String(remaining))} tk`,
    largest && largest.tokens > 0
      ? `  largest:   ${theme.warn(`${largest.category} (${largest.tokens} tk, ${largest.percentage.toFixed(1)}%)`)}`
      : `  largest:   ${theme.dim('none')}`,
    usedPct >= 100
      ? `  status:    ${theme.err('over budget')}`
      : usedPct >= config.contextWarn * 100
        ? `  status:    ${theme.warn('approaching budget')}`
        : `  status:    ${theme.ok('healthy')}`,
    '',
    theme.brand('By category'),
    ...categoryLines,
    '',
    theme.brand('By message'),
    ...messageLines,
    '',
  ].join('\n');
}

export function renderTokenBar(used: number, total: number, width: number): string {
  const safeWidth = Math.max(1, width);
  const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, used / total));
  const fill = Math.round(ratio * safeWidth);
  const bar = '█'.repeat(fill) + '░'.repeat(Math.max(0, safeWidth - fill));
  return `[${bar}] ${Math.round(ratio * 100)}%`;
}

function countByRole(session: Session, role: string): number {
  return session.state.messages.filter((message) => String(message.role || '') === role).length;
}

function splitFileRefs(text: string): { mainText: string; refText: string } {
  if (!text) return { mainText: '', refText: '' };
  const markerIndex = text.indexOf(FILE_REF_HEADER);
  if (markerIndex === -1) return { mainText: text, refText: '' };
  return {
    mainText: text.slice(0, markerIndex).trimEnd(),
    refText: text.slice(markerIndex),
  };
}

function segmentForText(text: string): TokenSegment {
  if (!text) return { tokens: 0, bytes: 0 };
  return {
    tokens: countTokensSync(text),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

function toolCallsToText(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  return JSON.stringify(toolCalls);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.type === 'string') return JSON.stringify(record);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
