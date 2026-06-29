import crypto from 'node:crypto';
import { theme } from '../ui/theme.js';

export interface BackgroundTask {
  id: string;
  goal: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export class TaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();

  startTask(goal: string): string {
    const task: BackgroundTask = {
      id: crypto.randomUUID(),
      goal: goal.trim(),
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return task.id;
  }

  completeTask(id: string, result: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.result = result;
    delete task.error;
  }

  failTask(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;
    delete task.result;
  }

  getTask(id: string): BackgroundTask | undefined {
    const task = this.tasks.get(id);
    return task ? cloneTask(task) : undefined;
  }

  listTasks(): BackgroundTask[] {
    return [...this.tasks.values()].map(cloneTask);
  }

  formatTaskList(): string {
    const tasks = this.listTasks();
    if (tasks.length === 0)
      return `${theme.brand('Background tasks')}\n  ${theme.dim('No tasks.')}\n`;

    const lines = tasks.map(
      (task) =>
        `  ${statusMarker(task.status)} ${theme.hl(shortId(task.id))} ${task.goal} ${theme.dim(`(${task.status})`)}`,
    );
    return `${theme.brand('Background tasks')}\n${lines.join('\n')}\n`;
  }

  formatTaskResult(id: string): string {
    const task = this.getTask(id);
    if (!task) return `${theme.warn(`No background task matches "${id}".`)}\n`;

    const lines = [
      `${theme.brand('Background task')} ${theme.hl(shortId(task.id))}`,
      `  goal: ${task.goal}`,
      `  status: ${task.status}`,
      `  started: ${task.startedAt}`,
    ];

    if (task.completedAt) lines.push(`  completed: ${task.completedAt}`);
    if (task.result) lines.push(`  result: ${task.result}`);
    if (task.error) lines.push(`  error: ${task.error}`);

    return `${lines.join('\n')}\n`;
  }
}

export const backgroundTaskManager = new TaskManager();

function cloneTask(task: BackgroundTask): BackgroundTask {
  return { ...task };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function statusMarker(status: BackgroundTask['status']): string {
  switch (status) {
    case 'done':
      return theme.ok('✓');
    case 'failed':
      return theme.err('✗');
    default:
      return theme.dim('…');
  }
}
