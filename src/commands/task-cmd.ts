import { theme } from '../ui/theme.js';
import { TaskManager } from '../modes/background.js';

export function taskCommand(args: string[], manager: TaskManager): string {
  const [rawSubcommand = 'list', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand === 'list') return manager.formatTaskList();

  if (subcommand === 'status') {
    const id = rest[0]?.trim() ?? '';
    if (!id) return usage();
    const match = findByPrefix(manager, id);
    if (match.kind === 'match') {
      return manager.formatTaskResult(match.id);
    }
    return match.message;
  }

  if (subcommand === 'cancel') {
    const id = rest[0]?.trim() ?? '';
    if (!id) return usage();
    const match = findByPrefix(manager, id);
    if (match.kind !== 'match') return match.message;
    const matchId = match.id;

    const task = manager.getTask(matchId);
    if (!task) return `${theme.warn(`No background task matches "${id}".`)}\n`;
    if (task.status !== 'running') {
      return `${theme.warn(`Task ${task.id.slice(0, 8)} is already ${task.status}.`)}\n`;
    }

    manager.failTask(task.id, 'Cancelled by user.');
    return `${theme.ok('Cancelled')} ${theme.hl(task.id.slice(0, 8))} ${task.goal}\n`;
  }

  return usage();
}

function usage(): string {
  return 'Usage: /tasks | /task list | /task status <id-prefix> | /task cancel <id-prefix>\n';
}

function findByPrefix(
  manager: TaskManager,
  prefix: string,
):
  | { kind: 'match'; id: string }
  | { kind: 'missing'; message: string }
  | { kind: 'ambiguous'; message: string } {
  const normalizedPrefix = prefix.toLowerCase();
  const matches = manager
    .listTasks()
    .filter((task) => task.id === prefix || task.id.toLowerCase().startsWith(normalizedPrefix));

  if (matches.length === 0) {
    return { kind: 'missing', message: `${theme.warn(`No background task matches "${prefix}".`)}\n` };
  }
  if (matches.length > 1) {
    const options = matches.map((task) => task.id.slice(0, 8)).join(', ');
    return {
      kind: 'ambiguous',
      message: `${theme.warn(`Multiple background tasks match "${prefix}": ${options}`)}\n`,
    };
  }
  return { kind: 'match', id: matches[0]!.id };
}
