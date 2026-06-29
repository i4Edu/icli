import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Schedule {
  type: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  time?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  expression?: string;
}

export interface CloudRoutine {
  id: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
}

export interface RoutineExecutionLog {
  id: string;
  routineId: string;
  timestamp: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  duration: number;
}

const ROUTINES_ENV = 'ICOPILOT_CLOUD_ROUTINES_PATH';
const LOGS_ENV = 'ICOPILOT_CLOUD_ROUTINES_LOGS_PATH';

function routinesPath(): string {
  return process.env[ROUTINES_ENV] || path.join(os.homedir(), '.icopilot', 'cloud-routines.json');
}

function logsPath(): string {
  return process.env[LOGS_ENV] || path.join(os.homedir(), '.icopilot', 'cloud-routines-logs.json');
}

export class CloudRoutineStore {
  private routines: Map<string, CloudRoutine> = new Map();
  private logs: RoutineExecutionLog[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    this.loadRoutines();
    this.loadLogs();
  }

  private loadRoutines(): void {
    const file = routinesPath();
    if (!fs.existsSync(file)) {
      this.routines = new Map();
      return;
    }

    try {
      const data = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(data) as unknown;
      if (Array.isArray(parsed)) {
        this.routines.clear();
        for (const item of parsed) {
          if (isCloudRoutine(item)) {
            this.routines.set(item.id, item);
          }
        }
      }
    } catch {
      this.routines = new Map();
    }
  }

  private loadLogs(): void {
    const file = logsPath();
    if (!fs.existsSync(file)) {
      this.logs = [];
      return;
    }

    try {
      const data = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(data) as unknown;
      if (Array.isArray(parsed)) {
        this.logs = parsed.filter(isRoutineExecutionLog);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveRoutines(): void {
    const dir = path.dirname(routinesPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = Array.from(this.routines.values());
    fs.writeFileSync(routinesPath(), JSON.stringify(data, null, 2), 'utf8');
  }

  private saveLogs(): void {
    const dir = path.dirname(logsPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(logsPath(), JSON.stringify(this.logs, null, 2), 'utf8');
  }

  create(name: string, schedule: Schedule, prompt: string, enabled = true): CloudRoutine {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('routine name is required');
    }

    if (!isValidSchedule(schedule)) {
      throw new Error('invalid schedule configuration');
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('routine prompt is required');
    }

    const routine: CloudRoutine = {
      id: randomUUID(),
      name: trimmedName,
      prompt: trimmedPrompt,
      schedule,
      enabled,
      createdAt: new Date().toISOString(),
      nextRun: calculateNextRun(schedule),
    };

    this.routines.set(routine.id, routine);
    this.saveRoutines();
    return routine;
  }

  list(): CloudRoutine[] {
    return Array.from(this.routines.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  get(id: string): CloudRoutine | undefined {
    return this.routines.get(id);
  }

  update(id: string, updates: Partial<Omit<CloudRoutine, 'id' | 'createdAt'>>): CloudRoutine {
    const routine = this.routines.get(id);
    if (!routine) {
      throw new Error(`routine with id ${id} not found`);
    }

    if (updates.name !== undefined && !updates.name.trim()) {
      throw new Error('routine name cannot be empty');
    }

    if (updates.prompt !== undefined && !updates.prompt.trim()) {
      throw new Error('routine prompt cannot be empty');
    }

    if (updates.schedule !== undefined && !isValidSchedule(updates.schedule)) {
      throw new Error('invalid schedule configuration');
    }

    const updated: CloudRoutine = {
      ...routine,
      ...updates,
      id: routine.id,
      createdAt: routine.createdAt,
    };

    if (updates.schedule) {
      updated.nextRun = calculateNextRun(updates.schedule);
    }

    this.routines.set(id, updated);
    this.saveRoutines();
    return updated;
  }

  delete(id: string): boolean {
    if (!this.routines.has(id)) {
      return false;
    }
    this.routines.delete(id);
    this.saveRoutines();
    return true;
  }

  updateLastRun(id: string, timestamp: string): void {
    const routine = this.routines.get(id);
    if (routine) {
      routine.lastRun = timestamp;
      routine.nextRun = calculateNextRun(routine.schedule);
      this.routines.set(id, routine);
      this.saveRoutines();
    }
  }

  getNextRun(id: string): string | undefined {
    const routine = this.routines.get(id);
    return routine?.nextRun;
  }

  findDueRoutines(): CloudRoutine[] {
    const now = new Date();
    return this.list().filter((r) => {
      if (!r.enabled || !r.nextRun) return false;
      return new Date(r.nextRun) <= now;
    });
  }

  logExecution(
    routineId: string,
    status: 'success' | 'error',
    output?: string,
    error?: string,
    duration = 0,
  ): RoutineExecutionLog {
    const log: RoutineExecutionLog = {
      id: randomUUID(),
      routineId,
      timestamp: new Date().toISOString(),
      status,
      output,
      error,
      duration,
    };

    this.logs.push(log);
    this.saveLogs();
    return log;
  }

  getLogs(routineId: string, limit = 20): RoutineExecutionLog[] {
    return this.logs
      .filter((log) => log.routineId === routineId)
      .slice(-limit)
      .reverse();
  }

  getAllLogs(limit = 100): RoutineExecutionLog[] {
    return this.logs.slice(-limit).reverse();
  }
}

function isValidSchedule(schedule: Schedule): boolean {
  if (!schedule || typeof schedule !== 'object') return false;

  const { type } = schedule;
  if (!type || !['once', 'daily', 'weekly', 'monthly', 'custom'].includes(type)) {
    return false;
  }

  if (type === 'daily' && !schedule.time) return false;
  if (type === 'weekly' && (schedule.dayOfWeek === undefined || !schedule.time)) return false;
  if (type === 'monthly' && (schedule.dayOfMonth === undefined || !schedule.time)) return false;
  if (type === 'custom' && !schedule.expression) return false;

  return true;
}

function calculateNextRun(schedule: Schedule): string {
  const now = new Date();

  switch (schedule.type) {
    case 'once': {
      return now.toISOString();
    }
    case 'daily': {
      const time = schedule.time || '09:00';
      const [hours, minutes] = parseTime(time);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);

      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }
    case 'weekly': {
      const time = schedule.time || '09:00';
      const dayOfWeek = schedule.dayOfWeek ?? 0;
      const [hours, minutes] = parseTime(time);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);

      const daysUntilTarget = (dayOfWeek - next.getDay() + 7) % 7;
      if (daysUntilTarget === 0 && next <= now) {
        next.setDate(next.getDate() + 7);
      } else if (daysUntilTarget > 0) {
        next.setDate(next.getDate() + daysUntilTarget);
      }
      return next.toISOString();
    }
    case 'monthly': {
      const time = schedule.time || '09:00';
      const dayOfMonth = schedule.dayOfMonth ?? 1;
      const [hours, minutes] = parseTime(time);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      next.setDate(dayOfMonth);

      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(dayOfMonth);
      }
      return next.toISOString();
    }
    case 'custom': {
      return now.toISOString();
    }
    default: {
      return now.toISOString();
    }
  }
}

function parseTime(timeStr: string): [hours: number, minutes: number] {
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):?(\d{2})?/);

  if (!match) {
    throw new Error(`invalid time format: ${timeStr}`);
  }

  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid time values: ${timeStr}`);
  }

  return [hours, minutes];
}

function isCloudRoutine(value: unknown): value is CloudRoutine {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.prompt === 'string' &&
    isValidSchedule(obj.schedule as Schedule) &&
    typeof obj.enabled === 'boolean' &&
    typeof obj.createdAt === 'string'
  );
}

function isRoutineExecutionLog(value: unknown): value is RoutineExecutionLog {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.routineId === 'string' &&
    typeof obj.timestamp === 'string' &&
    (obj.status === 'success' || obj.status === 'error') &&
    typeof obj.duration === 'number'
  );
}

let storeInstance: CloudRoutineStore | null = null;

export function getCloudRoutineStore(): CloudRoutineStore {
  if (!storeInstance) {
    storeInstance = new CloudRoutineStore();
  }
  return storeInstance;
}
