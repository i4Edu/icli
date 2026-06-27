import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

export interface StashEntry {
  id: string;
  name: string;
  messageCount: number;
  model: string;
  cwd: string;
  createdAt: string;
}

export interface StashData {
  messages: unknown[];
  model: string;
  cwd: string;
  mode: string;
}

interface StashRecord {
  entry: StashEntry;
  data: StashData;
}

const STASHES_ENV = 'ICOPILOT_STASHES_DIR';

export function stashesDir(): string {
  return process.env[STASHES_ENV] || path.join(os.homedir(), '.icopilot', 'stashes');
}

export function stashCommand(args: string[], session: Session): string {
  const action = args[0]?.toLowerCase() || 'list';

  if (action === 'push') {
    return pushStash(args.slice(1).join(' ').trim(), session);
  }

  if (action === 'pop') {
    return popStash(args.slice(1).join(' ').trim(), session);
  }

  if (action === 'list') {
    return listStashes();
  }

  if (action === 'drop' || action === 'delete' || action === 'rm') {
    const target = args.slice(1).join(' ').trim();
    if (!target) return usage();
    const stash = findStash(target);
    if (!stash) return `${theme.warn(`stash not found: ${target}`)}\n`;
    fs.rmSync(stash.file, { force: true });
    return `${theme.ok('Dropped')} stash ${theme.hl(stash.record.entry.name)}.\n`;
  }

  if (action === 'clear') {
    const stashes = readStashes();
    for (const stash of stashes) {
      fs.rmSync(stash.file, { force: true });
    }
    return `${theme.ok('Cleared')} ${stashes.length} stash${stashes.length === 1 ? '' : 'es'}.\n`;
  }

  return usage();
}

function pushStash(name: string, session: Session): string {
  const entry: StashEntry = {
    id: crypto.randomUUID(),
    name: name || autoName(),
    messageCount: session.state.messages.length,
    model: session.state.model,
    cwd: session.state.cwd,
    createdAt: new Date().toISOString(),
  };
  const data: StashData = {
    messages: [...session.state.messages],
    model: session.state.model,
    cwd: session.state.cwd,
    mode: session.state.mode,
  };

  fs.mkdirSync(stashesDir(), { recursive: true });
  fs.writeFileSync(stashFile(entry.id), `${JSON.stringify({ entry, data }, null, 2)}\n`, 'utf8');

  return (
    `${theme.ok('Stashed')} ${theme.hl(entry.name)} ${theme.dim(`(${entry.messageCount} messages)`)}` +
    `\n`
  );
}

function popStash(target: string, session: Session): string {
  const stash = target ? findStash(target) : readStashes()[0];
  if (!stash) return `${theme.warn('No stashes available.')}\n`;

  session.state.messages = [...stash.record.data.messages] as Session['state']['messages'];
  session.state.model = stash.record.data.model;
  session.state.cwd = stash.record.data.cwd;
  session.state.mode = stash.record.data.mode as Session['state']['mode'];
  session.persist();
  fs.rmSync(stash.file, { force: true });

  return (
    `${theme.ok('Restored')} ${theme.hl(stash.record.entry.name)} ${theme.dim(`(${stash.record.entry.messageCount} messages)`)}` +
    `\n`
  );
}

function listStashes(): string {
  const stashes = readStashes();
  if (stashes.length === 0) return 'No stashes.\n';

  const lines = stashes.map(({ record }) => {
    const when = formatDate(record.entry.createdAt);
    const count = `${record.entry.messageCount} msg${record.entry.messageCount === 1 ? '' : 's'}`;
    return `  ${theme.hl(record.entry.name)} ${theme.dim(`[${record.entry.id}]`)} ${theme.dim(when)} ${theme.dim(`(${count})`)}`;
  });
  return `${theme.brand('Stashes')}\n${lines.join('\n')}\n`;
}

function readStashes(): Array<{ file: string; record: StashRecord }> {
  const dir = stashesDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      try {
        return { file, record: normalizeRecord(JSON.parse(fs.readFileSync(file, 'utf8'))) };
      } catch {
        return null;
      }
    })
    .filter((stash): stash is { file: string; record: StashRecord } => stash !== null)
    .sort((a, b) => b.record.entry.createdAt.localeCompare(a.record.entry.createdAt));
}

function normalizeRecord(value: unknown): StashRecord {
  const source = typeof value === 'object' && value !== null ? (value as Partial<StashRecord>) : {};
  const entrySource =
    typeof source.entry === 'object' && source.entry !== null
      ? (source.entry as Partial<StashEntry>)
      : {};
  const dataSource =
    typeof source.data === 'object' && source.data !== null
      ? (source.data as Partial<StashData>)
      : {};

  const id =
    typeof entrySource.id === 'string' && entrySource.id ? entrySource.id : crypto.randomUUID();
  const messages = Array.isArray(dataSource.messages) ? dataSource.messages : [];
  const model = typeof dataSource.model === 'string' ? dataSource.model : '';
  const cwd = typeof dataSource.cwd === 'string' ? dataSource.cwd : '';
  const mode = typeof dataSource.mode === 'string' ? dataSource.mode : 'ask';
  const createdAt =
    typeof entrySource.createdAt === 'string' && entrySource.createdAt
      ? entrySource.createdAt
      : new Date().toISOString();

  return {
    entry: {
      id,
      name: typeof entrySource.name === 'string' && entrySource.name ? entrySource.name : id,
      messageCount:
        typeof entrySource.messageCount === 'number' && Number.isFinite(entrySource.messageCount)
          ? Math.max(0, Math.trunc(entrySource.messageCount))
          : messages.length,
      model: typeof entrySource.model === 'string' ? entrySource.model : model,
      cwd: typeof entrySource.cwd === 'string' ? entrySource.cwd : cwd,
      createdAt,
    },
    data: {
      messages,
      model,
      cwd,
      mode,
    },
  };
}

function findStash(target: string): { file: string; record: StashRecord } | undefined {
  const normalized = target.trim().toLowerCase();
  return readStashes().find(
    ({ record }) =>
      record.entry.id.toLowerCase() === normalized ||
      record.entry.name.toLowerCase() === normalized,
  );
}

function stashFile(id: string): string {
  return path.join(stashesDir(), `${id}.json`);
}

function autoName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `stash-${timestamp}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function usage(): string {
  return 'Usage: /stash [list] | /stash push [name] | /stash pop [id-or-name] | /stash drop <id-or-name> | /stash clear\n';
}
