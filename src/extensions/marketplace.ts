import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface PluginEntry {
  name: string;
  description: string;
  install: string;
  homepage?: string;
}

export interface PluginCatalog {
  search(query: string): Promise<PluginEntry[]>;
  list(): Promise<PluginEntry[]>;
}

export class LocalPluginCatalog implements PluginCatalog {
  constructor(private readonly file = path.join(os.homedir(), '.icopilot', 'plugins.json')) {}

  async list(): Promise<PluginEntry[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPluginEntry);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  }

  async search(query: string): Promise<PluginEntry[]> {
    const q = query.trim().toLowerCase();
    const entries = await this.list();
    if (!q) return entries;
    return entries.filter((entry) =>
      [entry.name, entry.description, entry.install, entry.homepage || '']
        .join('\n')
        .toLowerCase()
        .includes(q),
    );
  }
}

function isPluginEntry(value: unknown): value is PluginEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.description === 'string' &&
    typeof entry.install === 'string' &&
    (entry.homepage === undefined || typeof entry.homepage === 'string')
  );
}

let _catalog: PluginCatalog = new LocalPluginCatalog();

export function registerPluginCatalog(c: PluginCatalog): void {
  _catalog = c;
}

export function getPluginCatalog(): PluginCatalog {
  return _catalog;
}
