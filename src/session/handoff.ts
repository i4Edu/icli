import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { TodoItem } from '../commands/todo-cmd.js';
import type { MemoryEntry } from '../context/persistent-memory.js';
import { PersistentMemory } from '../context/persistent-memory.js';
import type { GitFile } from '../context/git-context.js';
import type { PinnedFile } from '../context/pinned.js';
import type { SessionState } from './session.js';
import { Session } from './session.js';

const HANDOFF_VERSION = 1;
const DEFAULT_FILENAME = '.icopilot-handoff.json';

export interface HandoffFile {
  path: string;
  content: string;
  addedAt?: string;
  tokens?: number;
  missing?: boolean;
}

export interface HandoffBundle {
  version: number;
  session: SessionState;
  context: {
    files: HandoffFile[];
    pinned: PinnedFile[];
    memory: MemoryEntry[];
  };
  metadata: {
    author: string;
    timestamp: string;
    branch: string;
    description: string;
  };
}

export interface CreateHandoffOptions {
  author?: string;
  description?: string;
  maxMessages?: number;
  branch?: string;
  memoryStorePath?: string;
}

export function createHandoff(session: Session, opts: CreateHandoffOptions = {}): HandoffBundle {
  const pinned = clonePinned(session.state.pinned);
  const memory = loadPersistentMemory(session.state.cwd, opts.memoryStorePath);
  const files = pinned.map((file) => snapshotPinnedFile(file));
  const messages = limitMessages(session.state.messages, opts.maxMessages);

  return {
    version: HANDOFF_VERSION,
    session: {
      id: session.state.id,
      createdAt: session.state.createdAt,
      model: session.state.model,
      mode: session.state.mode,
      cwd: session.state.cwd,
      messages: cloneMessages(messages),
      todos: cloneTodos(session.state.todos),
      autopilotEnabled: Boolean(session.state.autopilotEnabled),
      systemPrompt:
        typeof session.state.systemPrompt === 'string' ? session.state.systemPrompt : undefined,
      pinned,
      gitContext: cloneGitContext(session.state.gitContext),
    },
    context: {
      files,
      pinned,
      memory,
    },
    metadata: {
      author: opts.author?.trim() || detectAuthor(),
      timestamp: new Date().toISOString(),
      branch: opts.branch?.trim() || detectBranch(session.state.cwd),
      description: opts.description?.trim() || '',
    },
  };
}

export function receiveHandoff(bundle: HandoffBundle): Session {
  const normalized = validateHandoffBundle(bundle);
  const importedContext = buildImportedContextMessage(normalized);
  const session = new Session({
    createdAt: normalized.session.createdAt,
    model: normalized.session.model,
    mode: normalized.session.mode,
    cwd: normalized.session.cwd,
    messages: importedContext
      ? [{ role: 'system', content: importedContext }, ...cloneMessages(normalized.session.messages)]
      : cloneMessages(normalized.session.messages),
    todos: cloneTodos(normalized.session.todos),
    autopilotEnabled: Boolean(normalized.session.autopilotEnabled),
    systemPrompt:
      typeof normalized.session.systemPrompt === 'string'
        ? normalized.session.systemPrompt
        : undefined,
    pinned: clonePinned(normalized.context.pinned),
    gitContext: cloneGitContext(normalized.session.gitContext),
  });

  restorePersistentMemory(session.state.cwd, normalized.context.memory);
  session.persist();
  return session;
}

export function exportHandoffFile(bundle: HandoffBundle, targetPath?: string): string {
  const normalized = validateHandoffBundle(bundle);
  const target = resolveHandoffPath(normalized.session.cwd, targetPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return target;
}

export function importHandoffFile(targetPath: string): HandoffBundle {
  const resolved = path.resolve(targetPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown;
  return validateHandoffBundle(parsed);
}

export function previewHandoff(bundle: HandoffBundle): string {
  const normalized = validateHandoffBundle(bundle);
  const previewFiles = normalized.context.files.map((file) =>
    file.missing ? `${file.path} (missing snapshot)` : file.path,
  );

  const lines = [
    'Handoff bundle',
    `  version: ${normalized.version}`,
    `  author: ${normalized.metadata.author}`,
    `  timestamp: ${normalized.metadata.timestamp}`,
    `  branch: ${normalized.metadata.branch || '(unknown)'}`,
    `  description: ${normalized.metadata.description || '(none)'}`,
    `  cwd: ${normalized.session.cwd}`,
    `  model: ${normalized.session.model}`,
    `  mode: ${normalized.session.mode}`,
    `  messages: ${normalized.session.messages.length}`,
    `  todos: ${normalized.session.todos.length}`,
    `  pinned: ${normalized.context.pinned.length}`,
    `  memory: ${normalized.context.memory.length}`,
  ];

  if (previewFiles.length) {
    lines.push('  files:');
    previewFiles.forEach((file) => lines.push(`    - ${file}`));
  }

  return `${lines.join('\n')}\n`;
}

function validateHandoffBundle(input: unknown): HandoffBundle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Handoff bundle must be a JSON object.');
  }

  const bundle = input as Partial<HandoffBundle>;
  if (bundle.version !== HANDOFF_VERSION) {
    throw new Error(
      `Unsupported handoff bundle version: ${typeof bundle.version === 'number' ? bundle.version : 'unknown'}.`,
    );
  }

  return {
    version: HANDOFF_VERSION,
    session: validateSessionState(bundle.session),
    context: validateContext(bundle.context),
    metadata: validateMetadata(bundle.metadata),
  };
}

function validateSessionState(input: unknown): SessionState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Handoff bundle session is missing.');
  }

  const session = input as Partial<SessionState>;
  const mode = session.mode === 'plan' ? 'plan' : 'ask';
  if (typeof session.id !== 'string' || !session.id.trim()) {
    throw new Error('Handoff bundle session id is missing.');
  }
  if (typeof session.createdAt !== 'string' || !session.createdAt.trim()) {
    throw new Error('Handoff bundle session createdAt is missing.');
  }
  if (typeof session.model !== 'string' || !session.model.trim()) {
    throw new Error('Handoff bundle session model is missing.');
  }
  if (typeof session.cwd !== 'string' || !session.cwd.trim()) {
    throw new Error('Handoff bundle session cwd is missing.');
  }
  if (!Array.isArray(session.messages)) {
    throw new Error('Handoff bundle session messages must be an array.');
  }

  return {
    id: session.id,
    createdAt: session.createdAt,
    model: session.model,
    mode,
    cwd: session.cwd,
    messages: cloneMessages(session.messages),
    todos: cloneTodos(session.todos),
    autopilotEnabled: Boolean(session.autopilotEnabled),
    systemPrompt:
      typeof session.systemPrompt === 'string' ? session.systemPrompt : undefined,
    pinned: clonePinned(session.pinned),
    gitContext: cloneGitContext(session.gitContext),
  };
}

function validateContext(input: unknown): HandoffBundle['context'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Handoff bundle context is missing.');
  }

  const context = input as Partial<HandoffBundle['context']>;
  if (!Array.isArray(context.files)) {
    throw new Error('Handoff bundle context files must be an array.');
  }
  if (!Array.isArray(context.pinned)) {
    throw new Error('Handoff bundle context pinned must be an array.');
  }
  if (!Array.isArray(context.memory)) {
    throw new Error('Handoff bundle context memory must be an array.');
  }

  return {
    files: context.files.flatMap((file) => {
      if (!file || typeof file !== 'object') return [];
      const candidate = file as Partial<HandoffFile>;
      if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') return [];
      return [
        {
          path: candidate.path,
          content: candidate.content,
          addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt : undefined,
          tokens: typeof candidate.tokens === 'number' ? candidate.tokens : undefined,
          missing: Boolean(candidate.missing),
        },
      ];
    }),
    pinned: clonePinned(context.pinned),
    memory: cloneMemoryEntries(context.memory),
  };
}

function validateMetadata(input: unknown): HandoffBundle['metadata'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Handoff bundle metadata is missing.');
  }

  const metadata = input as Partial<HandoffBundle['metadata']>;
  if (typeof metadata.author !== 'string' || !metadata.author.trim()) {
    throw new Error('Handoff bundle metadata author is missing.');
  }
  if (typeof metadata.timestamp !== 'string' || !metadata.timestamp.trim()) {
    throw new Error('Handoff bundle metadata timestamp is missing.');
  }
  if (typeof metadata.branch !== 'string') {
    throw new Error('Handoff bundle metadata branch is invalid.');
  }
  if (typeof metadata.description !== 'string') {
    throw new Error('Handoff bundle metadata description is invalid.');
  }

  return {
    author: metadata.author,
    timestamp: metadata.timestamp,
    branch: metadata.branch,
    description: metadata.description,
  };
}

function limitMessages(
  messages: ChatCompletionMessageParam[],
  maxMessages?: number,
): ChatCompletionMessageParam[] {
  if (typeof maxMessages !== 'number' || !Number.isFinite(maxMessages) || maxMessages <= 0) {
    return cloneMessages(messages);
  }
  return cloneMessages(messages.slice(-Math.floor(maxMessages)));
}

function snapshotPinnedFile(file: PinnedFile): HandoffFile {
  try {
    return {
      path: file.path,
      addedAt: file.addedAt,
      tokens: file.tokens,
      content: fs.readFileSync(file.path, 'utf8'),
      missing: false,
    };
  } catch {
    return {
      path: file.path,
      addedAt: file.addedAt,
      tokens: file.tokens,
      content: '',
      missing: true,
    };
  }
}

function loadPersistentMemory(cwd: string, storePath?: string): MemoryEntry[] {
  const memory = new PersistentMemory(storePath);
  memory.load(memory.getProjectId(cwd));
  return cloneMemoryEntries(memory.recall());
}

function restorePersistentMemory(cwd: string, entries: MemoryEntry[]): void {
  const memory = new PersistentMemory();
  const projectId = memory.getProjectId(cwd);
  for (const entry of entries) {
    memory.remember(entry.key, entry.value, entry.source);
  }
  memory.save(projectId);
}

function buildImportedContextMessage(bundle: HandoffBundle): string {
  const lines = [
    'Imported handoff bundle context.',
    `Author: ${bundle.metadata.author}`,
    `Timestamp: ${bundle.metadata.timestamp}`,
    `Branch: ${bundle.metadata.branch || '(unknown)'}`,
  ];

  if (bundle.metadata.description) {
    lines.push(`Description: ${bundle.metadata.description}`);
  }

  if (bundle.context.memory.length) {
    lines.push('', 'Persistent memory:');
    for (const entry of bundle.context.memory) {
      lines.push(`- ${entry.key}: ${entry.value} (${entry.source}, ${entry.addedAt})`);
    }
  }

  if (bundle.context.files.length) {
    lines.push('', 'Pinned file snapshots:');
    for (const file of bundle.context.files) {
      lines.push('', `File: ${file.path}`);
      if (file.missing) {
        lines.push('[snapshot unavailable]');
        continue;
      }
      lines.push('```');
      lines.push(file.content);
      lines.push('```');
    }
  }

  return lines.join('\n');
}

function detectAuthor(): string {
  return (
    process.env.GIT_AUTHOR_NAME?.trim() ||
    process.env.GIT_COMMITTER_NAME?.trim() ||
    process.env.USERNAME?.trim() ||
    process.env.USER?.trim() ||
    'unknown'
  );
}

function detectBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function resolveHandoffPath(cwd: string, targetPath?: string): string {
  if (!targetPath?.trim()) return path.resolve(cwd, DEFAULT_FILENAME);
  const resolved = path.resolve(cwd, targetPath.trim());
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, DEFAULT_FILENAME);
    }
  } catch {
    /* ignore stat errors */
  }
  return resolved;
}

function cloneMessages(messages: ChatCompletionMessageParam[] | undefined): ChatCompletionMessageParam[] {
  if (!Array.isArray(messages)) return [];
  return JSON.parse(JSON.stringify(messages)) as ChatCompletionMessageParam[];
}

function cloneTodos(todos: TodoItem[] | undefined): TodoItem[] {
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo) => {
    if (!todo || typeof todo !== 'object') return [];
    const candidate = todo as Partial<TodoItem>;
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
        completedAt:
          typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
      },
    ];
  });
}

function clonePinned(files: PinnedFile[] | undefined): PinnedFile[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== 'object') return [];
    const candidate = file as Partial<PinnedFile>;
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

function cloneGitContext(files: GitFile[] | undefined): GitFile[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== 'object') return [];
    const candidate = file as Partial<GitFile>;
    if (typeof candidate.path !== 'string' || typeof candidate.status !== 'string') {
      return [];
    }
    return [
      {
        path: candidate.path,
        status: candidate.status,
      },
    ];
  });
}

function cloneMemoryEntries(entries: MemoryEntry[] | undefined): MemoryEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<MemoryEntry>;
    if (
      typeof candidate.key !== 'string' ||
      typeof candidate.value !== 'string' ||
      typeof candidate.addedAt !== 'string' ||
      (candidate.source !== 'user' && candidate.source !== 'auto')
    ) {
      return [];
    }
    return [
      {
        key: candidate.key,
        value: candidate.value,
        addedAt: candidate.addedAt,
        source: candidate.source,
      },
    ];
  });
}
