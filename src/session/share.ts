import fs from 'node:fs';
import path from 'node:path';
import type { TodoItem } from '../commands/todo-cmd.js';
import type { PinnedFile } from '../context/pinned.js';
import type { Mode, SessionState } from './session.js';
import { Session } from './session.js';
import { theme } from '../ui/theme.js';

const SHARE_VERSION = 1;
const DEFAULT_TITLE_PREFIX = 'Shared session';

export interface SharedSession {
  version: number;
  id: string;
  title: string;
  model: string;
  messages: any[];
  metadata: SessionMetadata;
  exportedAt: string;
}

export interface SessionMetadata {
  cwd: string;
  tokensUsed: number;
  messageCount: number;
  createdAt: string;
  duration: string;
}

export interface ImportResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

type PortableSharedSession = SharedSession & {
  mode?: Mode;
  todos?: TodoItem[];
  pinned?: PinnedFile[];
};

export function exportSessionBundle(session: Session): SharedSession {
  const bundle: PortableSharedSession = {
    version: SHARE_VERSION,
    id: session.state.id,
    title: deriveTitle(session.state),
    model: session.state.model,
    messages: clone(session.state.messages),
    metadata: {
      cwd: session.state.cwd,
      tokensUsed: session.tokenUsage(),
      messageCount: session.state.messages.length,
      createdAt: session.state.createdAt,
      duration: formatDuration(session.state.createdAt),
    },
    exportedAt: new Date().toISOString(),
    mode: session.state.mode,
    todos: cloneTodos(session.state.todos),
    pinned: clonePinned(session.state.pinned),
  };
  return bundle;
}

export function importSessionBundle(data: string | object): ImportResult {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const bundle = validateBundle(parsed);
    const session = new Session({
      createdAt: bundle.metadata.createdAt,
      model: bundle.model,
      mode: bundle.mode === 'plan' ? 'plan' : 'ask',
      cwd: bundle.metadata.cwd,
      messages: clone(bundle.messages),
      todos: cloneTodos(bundle.todos),
      pinned: clonePinned(bundle.pinned),
    });
    session.persist();
    return { success: true, sessionId: session.state.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid session bundle.';
    return { success: false, error: message };
  }
}

export function sessionToMarkdown(session: Session): string {
  const bundle = exportSessionBundle(session);
  const lines = [
    `# ${bundle.title}`,
    '',
    '## Metadata',
    '',
    `- Session ID: ${bundle.id}`,
    `- Exported: ${bundle.exportedAt}`,
    `- Created: ${bundle.metadata.createdAt}`,
    `- Duration: ${bundle.metadata.duration}`,
    `- Model: ${bundle.model}`,
    `- Working directory: ${bundle.metadata.cwd}`,
    `- Tokens used: ${bundle.metadata.tokensUsed}`,
    `- Message count: ${bundle.metadata.messageCount}`,
    '',
    '## Conversation',
    '',
  ];

  bundle.messages.forEach((message, index) => {
    const role = typeof message?.role === 'string' ? message.role : 'message';
    const suffix =
      role === 'tool'
        ? ` ${(typeof message?.tool_call_id === 'string' ? message.tool_call_id : '')}`.trimEnd()
        : typeof message?.name === 'string'
          ? ` ${message.name}`
          : '';
    lines.push(`### ${index + 1}. ${role}${suffix}`, '');

    const content = contentToText(message?.content).trim();
    lines.push(content || '_[no content]_');

    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      lines.push('', '#### Tool calls', '', '```json', JSON.stringify(message.tool_calls, null, 2), '```');
    }

    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

export function sessionToClipboard(session: Session): string {
  const bundle = exportSessionBundle(session);
  const lines = [
    `[iCopilot] ${bundle.title}`,
    `session=${bundle.id} model=${bundle.model} messages=${bundle.metadata.messageCount} tokens=${bundle.metadata.tokensUsed}`,
  ];

  bundle.messages.forEach((message, index) => {
    const role = typeof message?.role === 'string' ? message.role : 'message';
    const text = truncate(singleLine(contentToText(message?.content)), 220) || '[no content]';
    lines.push(`${index + 1}. ${role}: ${text}`);
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      const toolNames = message.tool_calls
        .map((call: any) => {
          if (typeof call?.function?.name === 'string') return call.function.name;
          if (typeof call?.id === 'string') return call.id;
          return 'tool-call';
        })
        .join(', ');
      lines.push(`   tools: ${toolNames}`);
    }
  });

  return `${lines.join('\n')}\n`;
}

export function shareCommand(args: string[], session: Session): string {
  const [subcommand = '', ...rest] = args;
  const action = subcommand.toLowerCase();

  if (!action) return shareUsage();

  if (action === 'export') {
    const requestedPath = rest.join(' ').trim();
    const target = path.resolve(session.state.cwd, requestedPath || `session-${session.state.id}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(exportSessionBundle(session), null, 2)}\n`, 'utf8');
    return `${theme.ok('✔ exported shared session')} ${target}\n`;
  }

  if (action === 'import') {
    const requestedPath = rest.join(' ').trim();
    if (!requestedPath) return shareUsage();
    const target = path.resolve(session.state.cwd, requestedPath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return `${theme.err(`file not found: ${target}`)}\n`;
    }
    const result = importSessionBundle(fs.readFileSync(target, 'utf8'));
    if (!result.success) {
      return `${theme.err(`import failed: ${result.error || 'unknown error'}`)}\n`;
    }
    return `${theme.ok(`✔ imported session as ${result.sessionId}`)}\n`;
  }

  if (action === 'clipboard') {
    return sessionToClipboard(session);
  }

  return shareUsage();
}

function shareUsage(): string {
  return [
    'usage: /share export [path]',
    '       /share import <path>',
    '       /share clipboard',
    '',
  ].join('\n');
}

function validateBundle(input: unknown): PortableSharedSession {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Session bundle must be a JSON object.');
  }

  const bundle = input as Partial<PortableSharedSession>;
  if (typeof bundle.version !== 'number' || bundle.version < 1) {
    throw new Error('Session bundle version is invalid.');
  }
  if (typeof bundle.id !== 'string' || !bundle.id.trim()) {
    throw new Error('Session bundle id is missing.');
  }
  if (typeof bundle.title !== 'string' || !bundle.title.trim()) {
    throw new Error('Session bundle title is missing.');
  }
  if (typeof bundle.model !== 'string' || !bundle.model.trim()) {
    throw new Error('Session bundle model is missing.');
  }
  if (!Array.isArray(bundle.messages)) {
    throw new Error('Session bundle messages must be an array.');
  }
  if (typeof bundle.exportedAt !== 'string' || !bundle.exportedAt.trim()) {
    throw new Error('Session bundle export timestamp is missing.');
  }

  const metadata = validateMetadata(bundle.metadata);
  const mode = bundle.mode === 'plan' ? 'plan' : 'ask';

  return {
    version: bundle.version,
    id: bundle.id,
    title: bundle.title,
    model: bundle.model,
    messages: clone(bundle.messages),
    metadata,
    exportedAt: bundle.exportedAt,
    mode,
    todos: cloneTodos(bundle.todos),
    pinned: clonePinned(bundle.pinned),
  };
}

function validateMetadata(metadata: unknown): SessionMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Session bundle metadata is missing.');
  }

  const candidate = metadata as Partial<SessionMetadata>;
  if (typeof candidate.cwd !== 'string' || !candidate.cwd.trim()) {
    throw new Error('Session bundle cwd is missing.');
  }
  if (typeof candidate.tokensUsed !== 'number' || Number.isNaN(candidate.tokensUsed)) {
    throw new Error('Session bundle tokensUsed is invalid.');
  }
  if (typeof candidate.messageCount !== 'number' || Number.isNaN(candidate.messageCount)) {
    throw new Error('Session bundle messageCount is invalid.');
  }
  if (typeof candidate.createdAt !== 'string' || !candidate.createdAt.trim()) {
    throw new Error('Session bundle createdAt is missing.');
  }
  if (typeof candidate.duration !== 'string' || !candidate.duration.trim()) {
    throw new Error('Session bundle duration is missing.');
  }

  return {
    cwd: candidate.cwd,
    tokensUsed: candidate.tokensUsed,
    messageCount: candidate.messageCount,
    createdAt: candidate.createdAt,
    duration: candidate.duration,
  };
}

function deriveTitle(state: SessionState): string {
  for (const message of state.messages) {
    const text = singleLine(contentToText((message as any)?.content));
    if (text) return truncate(text, 72);
  }
  return `${DEFAULT_TITLE_PREFIX} ${state.id.slice(0, 8)}`;
}

function formatDuration(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 'unknown';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - created) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.type === 'string') return JSON.stringify(part);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<TodoItem>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.text !== 'string' ||
      typeof candidate.done !== 'boolean' ||
      typeof candidate.createdAt !== 'string'
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        text: candidate.text,
        done: candidate.done,
        createdAt: candidate.createdAt,
        ...(typeof candidate.completedAt === 'string' ? { completedAt: candidate.completedAt } : {}),
      },
    ];
  });
}

function clonePinned(value: unknown): PinnedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<PinnedFile>;
    if (
      typeof candidate.path !== 'string' ||
      typeof candidate.addedAt !== 'string' ||
      typeof candidate.tokens !== 'number'
    ) {
      return [];
    }
    return [
      {
        path: candidate.path,
        addedAt: candidate.addedAt,
        tokens: candidate.tokens,
      },
    ];
  });
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
