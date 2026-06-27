import { countTokensSync } from '../util/tokens.js';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

const PREVIEW_LIMIT = 80;

type SessionMessage = Session['state']['messages'][number];

export interface HistoryEntry {
  index: number;
  role: string;
  preview: string;
  tokens: number;
}

export function historyCommand(args: string[], session: Session): string {
  const subcommand = args[0]?.toLowerCase();
  const entries = buildEntries(session);

  if (!subcommand) {
    return formatEntries(
      entries.slice(-20),
      'History',
      `(${Math.min(20, entries.length)} of ${entries.length})`,
    );
  }

  if (subcommand === 'search') {
    const query = args.slice(1).join(' ').trim();
    if (!query) return usage();
    const queryLower = query.toLowerCase();
    const matches = entries.filter((entry) =>
      contentToText(session.state.messages[entry.index].content).toLowerCase().includes(queryLower),
    );
    if (matches.length === 0) return `${theme.warn(`No messages matched "${query}".`)}\n`;
    return formatEntries(
      matches,
      `History search ${theme.hl(query)}`,
      `(${matches.length} match${matches.length === 1 ? '' : 'es'})`,
    );
  }

  if (subcommand === 'show') {
    const rawIndex = args[1];
    const index = Number.parseInt(rawIndex ?? '', 10);
    if (!rawIndex || Number.isNaN(index)) return usage();
    const message = session.state.messages[index];
    if (!message) return `${theme.warn(`Message not found: ${rawIndex}`)}\n`;
    const content = contentToText(message.content);
    return [
      theme.brand(`Message ${index}`),
      `  role:   ${formatRole(String(message.role || 'message'))}`,
      `  tokens: ${theme.hl(String(tokensForContent(content)))}`,
      '',
      content || theme.dim('(empty)'),
      '',
    ].join('\n');
  }

  if (subcommand === 'count') {
    return [
      theme.brand('History count'),
      `  messages: ${theme.hl(String(session.state.messages.length))}`,
      `  tokens:   ${theme.hl(String(session.tokenUsage()))}`,
      '',
    ].join('\n');
  }

  return usage();
}

function buildEntries(session: Session): HistoryEntry[] {
  return session.state.messages.map((message, index) => buildEntry(message, index));
}

function buildEntry(message: SessionMessage, index: number): HistoryEntry {
  const content = contentToText(message.content);
  return {
    index,
    role: String(message.role || 'message'),
    preview: truncatePreview(content),
    tokens: tokensForContent(content),
  };
}

function formatEntries(entries: HistoryEntry[], heading: string, detail?: string): string {
  if (entries.length === 0) return `${theme.warn('No messages in session history.')}\n`;

  const indexWidth = Math.max(2, String(entries[entries.length - 1]?.index ?? 0).length);
  const roleWidth = Math.max(...entries.map((entry) => entry.role.length), 4);
  const lines = entries.map((entry) => {
    const preview = entry.preview || theme.dim('(empty)');
    return `  ${theme.dim(String(entry.index).padStart(indexWidth))}  ${formatRole(entry.role.padEnd(roleWidth))}  ${preview}`;
  });
  const header = detail ? `${theme.brand(heading)} ${theme.dim(detail)}` : theme.brand(heading);
  return `${header}\n${lines.join('\n')}\n`;
}

function formatRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === 'user') return theme.user(role);
  if (normalized === 'assistant') return theme.assistant(role);
  if (normalized === 'system') return theme.system(role);
  return theme.dim(role);
}

function truncatePreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, PREVIEW_LIMIT - 1)}…`;
}

function tokensForContent(content: string): number {
  if (!content) return 0;
  try {
    return countTokensSync(content);
  } catch {
    return Math.ceil(content.length / 4);
  }
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

function usage(): string {
  return `Usage: /history | /history search <query> | /history show <index> | /history count\n`;
}
