import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// HistoryMessage type (matching HistoryItem.tsx definition)
export interface StoredMessage {
  id: string;
  role: 'user' | 'copilot' | 'error' | 'info' | 'system';
  content: string;
  reasoning?: string;
  model?: string;
  timestamp?: string;
}

export interface StoredSession {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  model: string;
  messages: StoredMessage[];
}

function getSessionsDir(): string {
  return path.join(os.homedir(), '.icopilot', 'sessions');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveSession(session: StoredSession): void {
  try {
    const dir = getSessionsDir();
    ensureDir(dir);
    const file = path.join(dir, `${session.id}.json`);
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
  } catch { /* ignore save errors */ }
}

export function loadSession(id: string): StoredSession | null {
  try {
    const file = path.join(getSessionsDir(), `${id}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as StoredSession;
  } catch { return null; }
}

export function listSessions(): StoredSession[] {
  try {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as StoredSession;
        } catch { return null; }
      })
      .filter((s): s is StoredSession => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}

export function deleteSession(id: string): void {
  try {
    const file = path.join(getSessionsDir(), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* ignore */ }
}

export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTimestamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
