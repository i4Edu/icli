import {
  TeamMemory,
  type TeamMemoryCategory,
  type TeamMemoryEntry,
} from '../context/team-memory.js';
import { theme } from '../ui/theme.js';

const CATEGORIES: TeamMemoryCategory[] = ['convention', 'decision', 'tip', 'warning'];

export function teamMemoryCommand(args: string[], cwd: string): string {
  const memory = new TeamMemory();
  const entries = memory.load(cwd);
  const [rawSubcommand = 'list', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand === 'list') {
    return formatEntries(entries, 'Team memory');
  }

  if (subcommand === 'add') {
    const category = parseCategory(rest[0]);
    const content = rest.slice(1).join(' ').trim();
    if (!category || !content) return usage();
    const entry: TeamMemoryEntry = {
      id: createEntryId(category, content, entries),
      category,
      content,
      date: new Date().toISOString().slice(0, 10),
    };
    memory.add(entry);
    return `${theme.ok('Added')} ${theme.hl(entry.id)} ${theme.dim(`[${entry.category}]`)} ${entry.content}\n`;
  }

  if (subcommand === 'remove') {
    const id = rest.join(' ').trim();
    if (!id) return usage();
    const match = findByIdPrefix(entries, id);
    if (match.kind === 'missing') return `${theme.warn(`No team memory entry matches "${id}".`)}\n`;
    if (match.kind === 'ambiguous') {
      return `${theme.warn(
        `Multiple team memory entries match "${id}": ${match.entries.map((entry) => entry.id).join(', ')}`,
      )}\n`;
    }
    memory.remove(match.entry.id);
    return `${theme.ok('Removed')} ${theme.hl(match.entry.id)}\n`;
  }

  if (subcommand === 'search') {
    const query = rest.join(' ').trim();
    if (!query) return usage();
    return formatEntries(memory.search(query), `Team memory ${theme.dim(`(search: ${query})`)}`);
  }

  return usage();
}

function formatEntries(entries: TeamMemoryEntry[], header: string): string {
  if (entries.length === 0)
    return `${theme.brand(header)}\n  ${theme.dim('No shared team memory entries.')}\n`;
  const lines = entries.map((entry) => {
    const metadata = [entry.category, entry.author, entry.date].filter(Boolean).join(', ');
    return `  ${theme.hl(entry.id)} ${entry.content} ${theme.dim(`(${metadata})`)}`;
  });
  return `${theme.brand(header)}\n${lines.join('\n')}\n`;
}

function usage(): string {
  return `Usage: /team-memory [list] | /team-memory add <${CATEGORIES.join('|')}> <content> | /team-memory remove <id> | /team-memory search <query>\n`;
}

function parseCategory(value: string | undefined): TeamMemoryCategory | null {
  if (value === 'convention' || value === 'decision' || value === 'tip' || value === 'warning') {
    return value;
  }
  return null;
}

function createEntryId(
  category: TeamMemoryCategory,
  content: string,
  entries: TeamMemoryEntry[],
): string {
  const slug = slugify(content) || 'entry';
  const base = `${category}-${slug}`;
  let candidate = base;
  let suffix = 2;
  while (entries.some((entry) => entry.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 8)
    .join('-');
}

function findByIdPrefix(
  entries: TeamMemoryEntry[],
  prefix: string,
):
  | { kind: 'missing' }
  | { kind: 'ambiguous'; entries: TeamMemoryEntry[] }
  | { kind: 'match'; entry: TeamMemoryEntry } {
  const normalized = prefix.trim();
  const exact = entries.find((entry) => entry.id === normalized);
  if (exact) return { kind: 'match', entry: exact };
  const matches = entries.filter((entry) => entry.id.startsWith(normalized));
  if (matches.length === 0) return { kind: 'missing' };
  if (matches.length > 1) return { kind: 'ambiguous', entries: matches };
  return { kind: 'match', entry: matches[0] };
}
