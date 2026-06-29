import fs from 'node:fs';
import path from 'node:path';

export type TeamMemoryCategory = 'convention' | 'decision' | 'tip' | 'warning';

export interface TeamMemoryEntry {
  id: string;
  category: TeamMemoryCategory;
  content: string;
  author?: string;
  date?: string;
}

export const TEAM_MEMORY_FILE = '.icopilot/team-memory.md';

const FILE_HEADER = `# Team memory

<!-- Shared team memory for conventions, decisions, tips, and warnings. -->
`;

export class TeamMemory {
  private filePath: string | null = null;

  private entries: TeamMemoryEntry[] = [];

  load(projectRoot: string): TeamMemoryEntry[] {
    this.filePath = path.join(projectRoot, '.icopilot', 'team-memory.md');
    this.entries = readEntries(this.filePath);
    return this.list();
  }

  add(entry: TeamMemoryEntry): void {
    this.assertLoaded();
    const normalized = normalizeEntry(entry);
    this.entries = this.entries.filter((candidate) => candidate.id !== normalized.id);
    this.entries.push(normalized);
    this.persist();
  }

  remove(id: string): void {
    this.assertLoaded();
    const normalizedId = id.trim();
    if (!normalizedId) return;
    this.entries = this.entries.filter((entry) => entry.id !== normalizedId);
    this.persist();
  }

  list(): TeamMemoryEntry[] {
    return this.entries.map(cloneEntry);
  }

  render(): string {
    if (this.entries.length === 0) return '';
    return [
      '## Team memory',
      ...this.entries.map((entry) => {
        const meta = [entry.category, entry.author?.trim(), entry.date?.trim()].filter(
          (value): value is string => Boolean(value),
        );
        return `- [${meta.join(' • ')}] ${entry.content}`;
      }),
    ].join('\n');
  }

  search(query: string): TeamMemoryEntry[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list();
    return this.entries
      .filter((entry) =>
        [entry.id, entry.category, entry.content, entry.author, entry.date]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(normalized)),
      )
      .map(cloneEntry);
  }

  private assertLoaded(): void {
    if (!this.filePath) throw new Error('Team memory must be loaded before use.');
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, serializeEntries(this.entries), 'utf8');
  }
}

function readEntries(filePath: string): TeamMemoryEntry[] {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
    const text = fs.readFileSync(filePath, 'utf8');
    return parseEntries(text);
  } catch {
    return [];
  }
}

function parseEntries(markdown: string): TeamMemoryEntry[] {
  const entries: TeamMemoryEntry[] = [];
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('## ')) continue;

    const heading = line.slice(3).trim();
    const bodyLines: string[] = [];
    index += 1;
    while (index < lines.length && !lines[index].startsWith('## ')) {
      bodyLines.push(lines[index]);
      index += 1;
    }

    const entry = parseSection(heading, bodyLines.join('\n'));
    if (entry) entries.push(entry);

    if (index < lines.length && lines[index].startsWith('## ')) {
      index -= 1;
    }
  }

  return entries;
}

function parseSection(heading: string, body: string): TeamMemoryEntry | null {
  const match = body.trim().match(/^<!--\s*\n?([\s\S]*?)\n?-->\s*([\s\S]*)$/);
  if (!match) return null;

  const metadata = parseMetadata(match[1] ?? '');
  const category = metadata.category;
  const content = (match[2] ?? '').trim();
  if (!isCategory(category) || !content) return null;

  const id = typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : heading;
  if (!id) return null;

  return normalizeEntry({
    id,
    category,
    content,
    author: metadata.author,
    date: metadata.date,
  });
}

function parseMetadata(block: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    metadata[match[1].toLowerCase()] = match[2];
  }
  return metadata;
}

function serializeEntries(entries: TeamMemoryEntry[]): string {
  const blocks = entries.map((entry) => {
    const metadataLines = [`id: ${entry.id}`, `category: ${entry.category}`];
    if (entry.author?.trim()) metadataLines.push(`author: ${entry.author.trim()}`);
    if (entry.date?.trim()) metadataLines.push(`date: ${entry.date.trim()}`);
    return [`## ${entry.id}`, '<!--', ...metadataLines, '-->', entry.content.trim()].join('\n');
  });

  return `${[FILE_HEADER.trimEnd(), ...blocks].join('\n\n').trimEnd()}\n`;
}

function normalizeEntry(entry: TeamMemoryEntry): TeamMemoryEntry {
  return {
    id: entry.id.trim(),
    category: entry.category,
    content: entry.content.trim(),
    author: entry.author?.trim() || undefined,
    date: entry.date?.trim() || undefined,
  };
}

function cloneEntry(entry: TeamMemoryEntry): TeamMemoryEntry {
  return { ...entry };
}

function isCategory(value: string | undefined): value is TeamMemoryCategory {
  return value === 'convention' || value === 'decision' || value === 'tip' || value === 'warning';
}
