import { randomUUID } from 'node:crypto';

export interface ScheduledTask {
  id: string;
  type: 'recurring' | 'once';
  interval: number;
  prompt: string;
  nextRun: Date;
}

type ScheduleRunner = (prompt: string) => void | Promise<void>;

interface ScheduledEntry {
  task: ScheduledTask;
  timer: NodeJS.Timeout;
  run: ScheduleRunner;
}

const scheduled = new Map<string, ScheduledEntry>();
let currentRunner: ScheduleRunner | null = null;

export function setScheduleRunner(runner: ScheduleRunner | null): void {
  currentRunner = runner;
}

export function scheduleRecurring(interval: string, prompt: string): ScheduledTask {
  return scheduleTask('recurring', interval, prompt);
}

export function scheduleOnce(delay: string, prompt: string): ScheduledTask {
  return scheduleTask('once', delay, prompt);
}

export function listScheduled(): ScheduledTask[] {
  return [...scheduled.values()]
    .map((entry) => ({ ...entry.task, nextRun: new Date(entry.task.nextRun) }))
    .sort((left, right) => left.nextRun.getTime() - right.nextRun.getTime());
}

export function cancelSchedule(id: string): boolean {
  const entry = scheduled.get(id);
  if (!entry) return false;
  clearTimer(entry.task.type, entry.timer);
  scheduled.delete(id);
  return true;
}

export function resetScheduledTasks(): void {
  for (const entry of scheduled.values()) {
    clearTimer(entry.task.type, entry.timer);
  }
  scheduled.clear();
}

export function parseInterval(input: string): number {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new Error('interval is required');

  const pattern = /(\d+)([hms])/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    consumed += match[0].length;
    total += value * unitToMs(unit);
  }

  if (consumed !== trimmed.length || total <= 0) {
    throw new Error(`invalid interval: ${input}`);
  }

  return total;
}

function scheduleTask(
  type: ScheduledTask['type'],
  intervalSource: string,
  prompt: string,
): ScheduledTask {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error('prompt is required');
  if (!currentRunner) throw new Error('scheduled prompts are not available in this session');

  const interval = parseInterval(intervalSource);
  const task: ScheduledTask = {
    id: randomUUID(),
    type,
    interval,
    prompt: normalizedPrompt,
    nextRun: new Date(Date.now() + interval),
  };

  const run = currentRunner;
  if (type === 'recurring') {
    const timer = setInterval(() => {
      void fireTask(task.id);
    }, interval);
    scheduled.set(task.id, { task, timer, run });
  } else {
    const timer = setTimeout(() => {
      void fireTask(task.id);
    }, interval);
    scheduled.set(task.id, { task, timer, run });
  }

  return { ...task, nextRun: new Date(task.nextRun) };
}

async function fireTask(id: string): Promise<void> {
  const entry = scheduled.get(id);
  if (!entry) return;

  if (entry.task.type === 'once') {
    scheduled.delete(id);
  } else {
    entry.task.nextRun = new Date(Date.now() + entry.task.interval);
  }

  await entry.run(entry.task.prompt);
}

function clearTimer(type: ScheduledTask['type'], timer: NodeJS.Timeout): void {
  if (type === 'recurring') clearInterval(timer);
  else clearTimeout(timer);
}

function unitToMs(unit: string): number {
  switch (unit) {
    case 'h':
      return 60 * 60 * 1000;
    case 'm':
      return 60 * 1000;
    case 's':
      return 1000;
    default:
      throw new Error(`unsupported interval unit: ${unit}`);
  }
}
