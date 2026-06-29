import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface MemoryEntry {
  key: string;
  value: string;
  addedAt: string;
  source: 'user' | 'auto';
}

export class PersistentMemory {
  private readonly storePath: string;

  private entries: Map<string, MemoryEntry> = new Map();

  constructor(storePath = path.join(os.homedir(), '.icopilot', 'memory')) {
    this.storePath = resolveStorePath(storePath);
  }

  load(projectId: string): void {
    this.entries.clear();
    const filePath = this.filePath(projectId);
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const entry = parseMemoryEntry(item);
        if (!entry) continue;
        this.entries.set(entry.key, entry);
      }
    } catch {
      this.entries.clear();
    }
  }

  save(projectId: string): void {
    fs.mkdirSync(this.storePath, { recursive: true });
    const filePath = this.filePath(projectId);
    const payload = JSON.stringify(this.recall(), null, 2);
    fs.writeFileSync(filePath, `${payload}\n`, 'utf8');
  }

  remember(key: string, value: string, source: 'user' | 'auto' = 'user'): void {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) return;
    const existing = this.entries.get(normalizedKey);
    this.entries.set(normalizedKey, {
      key: normalizedKey,
      value: normalizedValue,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      source,
    });
  }

  forget(key: string): boolean {
    return this.entries.delete(key.trim());
  }

  recall(query?: string): MemoryEntry[] {
    const entries = [...this.entries.values()]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const normalizedQuery = query?.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(normalizedQuery) ||
        entry.value.toLowerCase().includes(normalizedQuery),
    );
  }

  render(): string {
    const entries = this.recall();
    if (entries.length === 0) return '';
    return [
      '## Persistent project memory',
      ...entries.map((entry) => `- ${entry.key}: ${entry.value}`),
    ].join('\n');
  }

  getProjectId(cwd: string): string {
    const normalized = path.resolve(cwd);
    const stable = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    return crypto.createHash('sha256').update(stable).digest('hex');
  }

  private filePath(projectId: string): string {
    return path.join(this.storePath, `${projectId}.json`);
  }
}

function parseMemoryEntry(value: unknown): MemoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.key !== 'string' ||
    typeof entry.value !== 'string' ||
    typeof entry.addedAt !== 'string' ||
    (entry.source !== 'user' && entry.source !== 'auto')
  ) {
    return null;
  }
  return {
    key: entry.key,
    value: entry.value,
    addedAt: entry.addedAt,
    source: entry.source,
  };
}

function resolveStorePath(storePath: string): string {
  if (storePath === '~') return os.homedir();
  if (/^~[\\/]/.test(storePath)) return path.join(os.homedir(), storePath.slice(2));
  return path.resolve(storePath);
}
