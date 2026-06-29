import { getCloudRoutineStore, type Schedule } from '../cloud/routine-storage.js';
import { theme } from '../ui/theme.js';

export async function cloudRoutineCommand(arg: string): Promise<string> {
  const store = getCloudRoutineStore();
  const parts = arg.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();

  switch (subcommand) {
    case 'create':
      return handleCreate(parts.slice(1), store);
    case 'list':
      return handleList(parts.slice(1), store);
    case 'show':
      return handleShow(parts.slice(1), store);
    case 'update':
      return handleUpdate(parts.slice(1), store);
    case 'delete':
      return handleDelete(parts.slice(1), store);
    case 'run':
      return handleRun(parts.slice(1), store);
    case 'logs':
      return handleLogs(parts.slice(1), store);
    default:
      return theme.err(
        'Unknown cloud-routine subcommand. Use: create, list, show, update, delete, run, logs',
      );
  }
}

function handleCreate(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  if (args.length < 3) {
    return theme.err(
      'Usage: /cloud-routine create <name> <schedule> <prompt>\n' +
        'Examples:\n' +
        '  /cloud-routine create "daily-standup" "daily 09:00" "generate standup"\n' +
        '  /cloud-routine create "weekly-review" "weekly 1 18:00" "code review checklist"',
    );
  }

  const name = args[0]!.replace(/^["']|["']$/g, '');
  const scheduleStr = args[1]!.replace(/^["']|["']$/g, '');
  const prompt = args
    .slice(2)
    .join(' ')
    .replace(/^["']|["']$/g, '');

  try {
    const schedule = parseSchedule(scheduleStr);
    const routine = store.create(name, schedule, prompt);
    return theme.ok(
      `✔ Routine "${routine.name}" created (ID: ${routine.id})\n` +
        `  Next run: ${formatDate(routine.nextRun)}`,
    );
  } catch (err) {
    return theme.err(
      `✘ Failed to create routine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function handleList(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const detail = args.includes('--detail');
  const routines = store.list();

  if (routines.length === 0) {
    return theme.dim('No cloud routines configured.');
  }

  let output = `${theme.brand('Cloud Routines')}\n`;

  if (detail) {
    for (const routine of routines) {
      output += `\n${theme.bold(routine.name)} (${routine.id})\n`;
      output += `  Enabled: ${routine.enabled ? '✓' : '✗'}\n`;
      output += `  Schedule: ${formatSchedule(routine.schedule)}\n`;
      output += `  Next Run: ${formatDate(routine.nextRun)}\n`;
      if (routine.lastRun) {
        output += `  Last Run: ${formatDate(routine.lastRun)}\n`;
      }
      output += `  Prompt: ${routine.prompt.substring(0, 60)}${routine.prompt.length > 60 ? '...' : ''}\n`;
    }
  } else {
    output += `${theme.dim('Name'.padEnd(30) + 'Status'.padEnd(10) + 'Next Run')}\n`;
    for (const routine of routines) {
      const status = routine.enabled ? '✓ active' : '✗ disabled';
      output += `${routine.name.padEnd(30)}${status.padEnd(10)}${formatDate(routine.nextRun)}\n`;
    }
  }

  return output;
}

function handleShow(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const id = args[0];
  if (!id) {
    return theme.err('Usage: /cloud-routine show <id>');
  }

  const routine = store.get(id);
  if (!routine) {
    return theme.err(`Routine with ID "${id}" not found.`);
  }

  let output = `${theme.bold(routine.name)}\n`;
  output += `  ID: ${routine.id}\n`;
  output += `  Enabled: ${routine.enabled ? '✓' : '✗'}\n`;
  output += `  Schedule: ${formatSchedule(routine.schedule)}\n`;
  output += `  Next Run: ${formatDate(routine.nextRun)}\n`;
  output += `  Created: ${formatDate(routine.createdAt)}\n`;
  if (routine.lastRun) {
    output += `  Last Run: ${formatDate(routine.lastRun)}\n`;
  }
  output += `\n${theme.dim('Prompt:')}\n${routine.prompt}\n`;

  const logs = store.getLogs(routine.id, 5);
  if (logs.length > 0) {
    output += `\n${theme.dim('Recent Executions:')}\n`;
    for (const log of logs) {
      const status = log.status === 'success' ? '✓' : '✘';
      output += `  ${status} ${formatDate(log.timestamp)} (${log.duration}ms)\n`;
    }
  }

  return output;
}

function handleUpdate(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const id = args[0];
  if (!id) {
    return theme.err(
      'Usage: /cloud-routine update <id> [--schedule <sched>] [--prompt <prompt>] [--enabled <true|false>]',
    );
  }

  const routine = store.get(id);
  if (!routine) {
    return theme.err(`Routine with ID "${id}" not found.`);
  }

  const updates: Record<string, unknown> = {};

  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    if (!flag || !value) continue;

    if (flag === '--schedule') {
      try {
        updates.schedule = parseSchedule(value);
      } catch (err) {
        return theme.err(`Invalid schedule: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (flag === '--prompt') {
      updates.prompt = value.replace(/^["']|["']$/g, '');
    } else if (flag === '--enabled') {
      updates.enabled = value.toLowerCase() === 'true';
    }
  }

  if (Object.keys(updates).length === 0) {
    return theme.err('No updates specified.');
  }

  try {
    const updated = store.update(id, updates as Parameters<typeof store.update>[1]);
    return theme.ok(`✔ Routine "${updated.name}" updated.`);
  } catch (err) {
    return theme.err(
      `✘ Failed to update routine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function handleDelete(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const id = args[0];
  if (!id) {
    return theme.err('Usage: /cloud-routine delete <id>');
  }

  const routine = store.get(id);
  if (!routine) {
    return theme.err(`Routine with ID "${id}" not found.`);
  }

  if (store.delete(id)) {
    return theme.ok(`✔ Routine "${routine.name}" deleted.`);
  }

  return theme.err('Failed to delete routine.');
}

function handleRun(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const id = args[0];
  if (!id) {
    return theme.err('Usage: /cloud-routine run <id>');
  }

  const routine = store.get(id);
  if (!routine) {
    return theme.err(`Routine with ID "${id}" not found.`);
  }

  return theme.ok(`✔ Routine "${routine.name}" queued for immediate execution. (manual trigger)`);
}

function handleLogs(args: string[], store: ReturnType<typeof getCloudRoutineStore>): string {
  const id = args[0];
  if (!id) {
    return theme.err('Usage: /cloud-routine logs <id> [--last N]');
  }

  const routine = store.get(id);
  if (!routine) {
    return theme.err(`Routine with ID "${id}" not found.`);
  }

  let limit = 20;
  const lastIdx = args.indexOf('--last');
  if (lastIdx !== -1 && args[lastIdx + 1]) {
    limit = parseInt(args[lastIdx + 1], 10) || 20;
  }

  const logs = store.getLogs(id, limit);

  if (logs.length === 0) {
    return theme.dim(`No execution logs for "${routine.name}".`);
  }

  let output = `${theme.bold(`Execution Logs: ${routine.name}`)}\n`;
  for (const log of logs) {
    const status = log.status === 'success' ? theme.ok('✓') : theme.err('✘');
    output += `${status} ${formatDate(log.timestamp)} (${log.duration}ms)`;
    if (log.error) {
      output += ` - ${log.error}`;
    }
    output += '\n';
  }

  return output;
}

function parseSchedule(scheduleStr: string): Schedule {
  const parts = scheduleStr.trim().toLowerCase().split(/\s+/);
  const type = parts[0];

  switch (type) {
    case 'once': {
      return { type: 'once' };
    }
    case 'daily': {
      const time = parts[1] || '09:00';
      return { type: 'daily', time };
    }
    case 'weekly': {
      const dayOfWeek = parseInt(parts[1]!, 10);
      const time = parts[2] || '09:00';
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new Error('day of week must be 0-6 (0=Sunday, 6=Saturday)');
      }
      return { type: 'weekly', dayOfWeek, time };
    }
    case 'monthly': {
      const dayOfMonth = parseInt(parts[1]!, 10);
      const time = parts[2] || '09:00';
      if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error('day of month must be 1-31');
      }
      return { type: 'monthly', dayOfMonth, time };
    }
    case 'custom': {
      const expression = parts.slice(1).join(' ');
      if (!expression) throw new Error('custom schedule requires an expression');
      return { type: 'custom', expression };
    }
    default:
      throw new Error(`unknown schedule type: ${type}`);
  }
}

function formatSchedule(schedule: Schedule): string {
  switch (schedule.type) {
    case 'once':
      return 'once';
    case 'daily':
      return `daily at ${schedule.time || '09:00'}`;
    case 'weekly': {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `weekly on ${days[schedule.dayOfWeek || 0]} at ${schedule.time || '09:00'}`;
    }
    case 'monthly':
      return `monthly on day ${schedule.dayOfMonth || 1} at ${schedule.time || '09:00'}`;
    case 'custom':
      return `custom: ${schedule.expression || ''}`;
    default:
      return 'unknown';
  }
}

function formatDate(date: string | undefined): string {
  if (!date) return 'never';
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}
