import { config } from '../config.js';
import { renderGitContextBlock } from '../context/git-context.js';
import { PinnedContext } from '../context/pinned.js';
import { PLAN_SYSTEM, getAskSystemPrompt } from './prompts.js';
import { loadMemoryBlock } from '../context/memory.js';
import { loadConventionPromptContext } from '../knowledge/conventions.js';
import { loadStylePromptContext } from '../knowledge/style-learner.js';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { countTokensSync } from '../util/tokens.js';
import { showContextUsage } from './context-viz-cmd.js';

export interface ContextSource {
  name: string;
  type: 'system' | 'file' | 'memory' | 'pinned' | 'git' | 'skill' | 'history';
  tokens: number;
  percentage: number;
}

export interface ContextBreakdown {
  sources: ContextSource[];
  total: number;
  budget: number;
  remaining: number;
}

const FILE_REF_HEADER = '### Referenced files';

export function buildContextBreakdown(session: Session): ContextBreakdown {
  const systemPrompt =
    session.state.systemPrompt ?? (session.state.mode === 'plan' ? PLAN_SYSTEM : getAskSystemPrompt());
  const memoryBlock = loadMemoryBlock(session.state.cwd) ?? '';
  const styleBlock = loadStylePromptContext(session.state.cwd) ?? '';
  const conventionBlock = loadConventionPromptContext(session.state.cwd) ?? '';
  const pinnedBlock = PinnedContext.fromJSON(session.state.pinned).render();
  const gitBlock = renderGitContextBlock(session.state.gitContext ?? []);

  let historyTokens = 0;
  let fileTokens = 0;
  let toolTokens = 0;

  for (const message of session.state.messages) {
    const role = String(message.role || 'message');
    const content = contentToText((message as { content?: unknown }).content);

    if (role === 'user') {
      const { mainText, refText } = splitFileRefs(content);
      historyTokens += safeCountTokens(mainText);
      fileTokens += safeCountTokens(refText);
      continue;
    }

    if (role === 'assistant') {
      historyTokens += safeCountTokens(content);
      toolTokens += safeCountTokens(toolCallsToText((message as { tool_calls?: unknown }).tool_calls));
      continue;
    }

    if (role === 'tool') {
      toolTokens += safeCountTokens(content);
      toolTokens += safeCountTokens(
        typeof (message as { tool_call_id?: unknown }).tool_call_id === 'string'
          ? (message as { tool_call_id: string }).tool_call_id
          : '',
      );
      continue;
    }

    historyTokens += safeCountTokens(content);
  }

  const sources: ContextSource[] = [
    source('System prompt', 'system', safeCountTokens(systemPrompt)),
    source('Style profile', 'system', safeCountTokens(styleBlock)),
    source('Conventions', 'system', safeCountTokens(conventionBlock)),
    source('File references', 'file', fileTokens),
    source('Memory', 'memory', safeCountTokens(memoryBlock)),
    source('Pinned files', 'pinned', safeCountTokens(pinnedBlock)),
    source('Git context', 'git', safeCountTokens(gitBlock)),
    source('Conversation history', 'history', historyTokens),
    source('Tool results', 'history', toolTokens),
  ];

  const total = sources.reduce((sum, entry) => sum + entry.tokens, 0);
  for (const entry of sources) {
    entry.percentage = total > 0 ? (entry.tokens / total) * 100 : 0;
  }

  const budget = config.contextWindow;
  return {
    sources,
    total,
    budget,
    remaining: Math.max(0, budget - total),
  };
}

export function renderContextBreakdown(breakdown: ContextBreakdown): string {
  const usedPct = breakdown.budget > 0 ? (breakdown.total / breakdown.budget) * 100 : 0;
  const status =
    usedPct >= 100
      ? theme.err('over budget')
      : usedPct >= config.contextWarn * 100
        ? theme.warn('approaching budget')
        : theme.ok('healthy');

  const lines = [
    theme.brand('Context hub'),
    `  used:      ${theme.hl(String(breakdown.total))} tk / ${theme.hl(String(breakdown.budget))} tk`,
    `  budget:    ${renderBudgetBar(breakdown.total, breakdown.budget, 28)} ${theme.dim(`(${usedPct.toFixed(1)}%)`)}`,
    `  remaining: ${breakdown.remaining > 0 ? theme.ok(String(breakdown.remaining)) : theme.err(String(breakdown.remaining))} tk`,
    `  status:    ${status}`,
    '',
    theme.brand('Sources'),
    ...breakdown.sources.map((entry) => renderSourceLine(entry, breakdown.total)),
    '',
  ];

  return lines.join('\n');
}

export function contextCommand(args: string[], session: Session): string {
  const breakdown = buildContextBreakdown(session);
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case undefined:
    case '':
      return showContextUsage(session);
    case 'sources':
      return renderSources(breakdown);
    case 'budget':
      return renderBudget(breakdown);
    case 'trim':
      return renderTrimSuggestions(breakdown);
    default:
      return `${theme.warn(`unknown /context subcommand: ${subcommand}`)}\n${theme.dim(
        'usage: /context [sources|budget|trim]',
      )}\n`;
  }
}

function renderSources(breakdown: ContextBreakdown): string {
  return [
    theme.brand('Context sources'),
    ...breakdown.sources.map(
      (entry) =>
        `  ${colorForType(entry.type)(entry.name.padEnd(22))} ${theme.hl(String(entry.tokens).padStart(6))} tk  ${theme.dim(
          `${entry.percentage.toFixed(1).padStart(5)}%`,
        )}  ${theme.dim(`(${entry.type})`)}`,
    ),
    '',
  ].join('\n');
}

function renderBudget(breakdown: ContextBreakdown): string {
  const usedPct = breakdown.budget > 0 ? (breakdown.total / breakdown.budget) * 100 : 0;
  return [
    theme.brand('Context budget'),
    `  ${renderBudgetBar(breakdown.total, breakdown.budget, 36)} ${theme.dim(`(${usedPct.toFixed(1)}% used)`)}`,
    `  remaining: ${breakdown.remaining > 0 ? theme.ok(String(breakdown.remaining)) : theme.err(String(breakdown.remaining))} tk`,
    '',
  ].join('\n');
}

function renderTrimSuggestions(breakdown: ContextBreakdown): string {
  const candidates = breakdown.sources
    .filter((entry) => entry.tokens > 0 && entry.name !== 'System prompt')
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name));

  if (!candidates.length) {
    return [theme.brand('Trim suggestions'), `  ${theme.dim('No context loaded yet.')}`, ''].join('\n');
  }

  return [
    theme.brand('Trim suggestions'),
    ...candidates.map((entry, index) => {
      const suggestion = trimSuggestion(entry);
      return `  ${index + 1}. ${colorForType(entry.type)(entry.name)} ${theme.hl(`(${entry.tokens} tk)`)} — ${suggestion}`;
    }),
    '',
  ].join('\n');
}

function renderSourceLine(entry: ContextSource, total: number): string {
  const label = colorForType(entry.type)(entry.name.padEnd(22));
  return `  ${label} ${theme.hl(String(entry.tokens).padStart(6))} tk  ${renderShareBar(entry.tokens, total, 18)} ${theme.dim(
    `${entry.percentage.toFixed(1).padStart(5)}%`,
  )}`;
}

function renderBudgetBar(used: number, total: number, width: number): string {
  const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, used / total));
  const fill = Math.round(ratio * width);
  const rawBar = '█'.repeat(fill) + '░'.repeat(Math.max(0, width - fill));
  const colored = ratio >= 1 ? theme.err(rawBar) : ratio >= config.contextWarn ? theme.warn(rawBar) : theme.ok(rawBar);
  return `[${colored}]`;
}

function renderShareBar(used: number, total: number, width: number): string {
  const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, used / total));
  const fill = Math.round(ratio * width);
  return `[${'█'.repeat(fill)}${'░'.repeat(Math.max(0, width - fill))}]`;
}

function trimSuggestion(entry: ContextSource): string {
  switch (entry.name) {
    case 'Conversation history':
      return 'run /compact or clear older turns';
    case 'File references':
      return 'remove large @file injections from the next prompt';
    case 'Pinned files':
      return 'unpin files you no longer need';
    case 'Git context':
      return 'trim the auto-injected git diff context';
    case 'Tool results':
      return 'compact the session to collapse verbose tool output';
    case 'Memory':
      return 'trim .icopilot/memory.md or .icopilot/team-memory.md to the essentials';
    case 'System prompt':
      return 'fixed overhead; optimize other sources first';
    default:
      return 'trim this source first';
  }
}

function colorForType(type: ContextSource['type']): (text: string) => string {
  switch (type) {
    case 'system':
      return theme.brand;
    case 'file':
      return theme.hl;
    case 'memory':
      return theme.ok;
    case 'pinned':
      return theme.warn;
    case 'git':
      return theme.assistant;
    case 'skill':
      return theme.assistant;
    case 'history':
    default:
      return theme.dim;
  }
}

function source(name: string, type: ContextSource['type'], tokens: number): ContextSource {
  return { name, type, tokens, percentage: 0 };
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

function toolCallsToText(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  return JSON.stringify(toolCalls);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
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

function safeCountTokens(text: string): number {
  if (!text) return 0;
  try {
    return countTokensSync(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}
