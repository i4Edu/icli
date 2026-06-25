import fs from 'node:fs/promises';
import path from 'node:path';
import { select } from '@inquirer/prompts';
import { Session } from './session.js';

export async function pickSession(): Promise<string | null> {
  const sessions = Session.list();
  if (!sessions.length) return null;

  return select({
    message: 'Resume session',
    choices: sessions.map((s) => ({
      name: `${s.id.slice(0, 8)}  ${s.model}  ${s.messageCount} msgs  ${age(s.mtime)}`,
      value: s.id,
      description: s.file,
    })),
  }).catch(() => null);
}

export async function exportSession(
  session: Session,
  format: 'md' | 'json',
  outPath?: string,
): Promise<string> {
  const target = path.resolve(
    session.state.cwd,
    outPath || `session-${session.state.id}.${format}`,
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    format === 'json' ? session.toJSON() + '\n' : session.toMarkdown(),
    'utf8',
  );
  return target;
}

function age(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
