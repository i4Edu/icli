import { PersistentMemory } from '../context/persistent-memory.js';
import { theme } from '../ui/theme.js';

export function memoryCommand(args: string[], cwd: string): string {
  const memory = new PersistentMemory();
  const projectId = memory.getProjectId(cwd);
  memory.load(projectId);

  const [rawSubcommand = 'list', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand === 'list') {
    return formatEntries(memory.recall(), 'Project memory');
  }

  if (subcommand === 'add') {
    const [key, ...valueParts] = rest;
    const value = valueParts.join(' ').trim();
    if (!key || !value) return usage();
    memory.remember(key, value, 'user');
    memory.save(projectId);
    return `${theme.ok('Remembered')} ${theme.hl(key)} ${theme.dim('→')} ${value}\n`;
  }

  if (subcommand === 'remove') {
    const key = rest[0]?.trim();
    if (!key) return usage();
    if (!memory.forget(key)) return `${theme.warn(`No memory entry found for "${key}".`)}\n`;
    memory.save(projectId);
    return `${theme.ok('Forgot')} ${theme.hl(key)}\n`;
  }

  if (subcommand === 'clear') {
    const entries = memory.recall();
    for (const entry of entries) memory.forget(entry.key);
    memory.save(projectId);
    return `${theme.ok(`Cleared ${entries.length} memory entr${entries.length === 1 ? 'y' : 'ies'}.`)}\n`;
  }

  if (subcommand === 'search') {
    const query = rest.join(' ').trim();
    if (!query) return usage();
    return formatEntries(memory.recall(query), `Project memory ${theme.dim(`(search: ${query})`)}`);
  }

  return usage();
}

function formatEntries(entries: ReturnType<PersistentMemory['recall']>, header: string): string {
  if (entries.length === 0) return `${theme.brand(header)}\n  ${theme.dim('No remembered facts.')}\n`;
  const lines = entries.map(
    (entry) =>
      `  ${theme.hl(entry.key)} = ${entry.value} ${theme.dim(`(${entry.source}, ${entry.addedAt})`)}`,
  );
  return `${theme.brand(header)}\n${lines.join('\n')}\n`;
}

function usage(): string {
  return 'Usage: /memory [list] | /memory add <key> <value> | /memory remove <key> | /memory clear | /memory search <query>\n';
}
