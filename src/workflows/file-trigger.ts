import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface FileTrigger {
  pattern: string;
  action: 'workflow' | 'command' | 'prompt';
  target: string;
  debounce?: number;
}

type FileTriggerCallback = (trigger: FileTrigger, file: string) => void;

interface FileTriggerManagerOptions {
  rootDir?: string;
  watch?: typeof fs.watch;
}

const DEFAULT_DEBOUNCE_MS = 500;
const TRIGGERS_FILE = 'triggers.json';
const TRIGGERS_DIR = '.icopilot';
const VALID_ACTIONS = new Set<FileTrigger['action']>(['workflow', 'command', 'prompt']);

export class FileTriggerManager {
  private rootDir: string;
  private triggers: FileTrigger[] = [];
  private readonly watchFn: typeof fs.watch;
  private readonly watchers = new Set<fs.FSWatcher>();
  private readonly callbacks = new Set<FileTriggerCallback>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(opts: FileTriggerManagerOptions = {}) {
    this.rootDir = path.resolve(opts.rootDir ?? config.cwd);
    this.watchFn = opts.watch ?? fs.watch.bind(fs);
    this.triggers = this.readTriggers();
  }

  addTrigger(trigger: FileTrigger): void {
    const normalized = normalizeTrigger(trigger);
    const next = this.triggers.filter((entry) => entry.pattern !== normalized.pattern);
    next.push(normalized);
    this.triggers = next.sort((a, b) => a.pattern.localeCompare(b.pattern));
    this.writeTriggers();
  }

  removeTrigger(pattern: string): void {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) return;

    this.triggers = this.triggers.filter((entry) => entry.pattern !== trimmedPattern);
    this.writeTriggers();
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (!key.startsWith(`${trimmedPattern}\0`)) continue;
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  listTriggers(): FileTrigger[] {
    return this.triggers.map((trigger) => ({ ...trigger }));
  }

  start(rootDir: string): void {
    this.stop();
    this.rootDir = path.resolve(rootDir || this.rootDir);
    this.triggers = this.readTriggers();
    const watcher = this.watchFn(this.rootDir, { recursive: true }, (_eventType, filename) =>
      this.handleWatchEvent(filename),
    );
    this.watchers.add(watcher);
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  onTrigger(callback: (trigger: FileTrigger, file: string) => void): void {
    this.callbacks.add(callback);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private handleWatchEvent(filename: string | Buffer | null): void {
    const relativePath = normalizeWatchedPath(filename);
    if (!relativePath) return;

    for (const trigger of this.triggers) {
      if (!matchesFileTriggerPattern(trigger.pattern, relativePath)) continue;
      const key = `${trigger.pattern}\0${relativePath}`;
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        for (const callback of this.callbacks) callback({ ...trigger }, relativePath);
      }, normalizeDebounce(trigger.debounce));
      this.debounceTimers.set(key, timer);
    }
  }

  private readTriggers(): FileTrigger[] {
    const file = triggerConfigPath(this.rootDir);
    if (!fs.existsSync(file)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isFileTrigger).map((trigger) => normalizeTrigger(trigger));
    } catch {
      return [];
    }
  }

  private writeTriggers(): void {
    const file = triggerConfigPath(this.rootDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(this.triggers, null, 2)}\n`, 'utf8');
  }
}

const managers = new Map<string, FileTriggerManager>();

export function getFileTriggerManager(rootDir = config.cwd): FileTriggerManager {
  const resolvedRoot = path.resolve(rootDir);
  const existing = managers.get(resolvedRoot);
  if (existing) return existing;

  const manager = new FileTriggerManager({ rootDir: resolvedRoot });
  managers.set(resolvedRoot, manager);
  return manager;
}

export function triggerConfigPath(rootDir = config.cwd): string {
  return path.join(path.resolve(rootDir), TRIGGERS_DIR, TRIGGERS_FILE);
}

export function matchesFileTriggerPattern(pattern: string, file: string): boolean {
  return fileTriggerPatternToRegExp(pattern).test(normalizePattern(file));
}

export function fileTriggerPatternToRegExp(pattern: string): RegExp {
  const normalized = normalizePattern(pattern);
  let source = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '*') {
      const nextChar = normalized[index + 1];
      const thirdChar = normalized[index + 2];
      if (nextChar === '*') {
        if (thirdChar === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
        continue;
      }

      source += '[^/]*';
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

function normalizeTrigger(trigger: FileTrigger): FileTrigger {
  const action = trigger.action;
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`invalid trigger action: ${String(trigger.action)}`);
  }

  const pattern = normalizePattern(trigger.pattern);
  if (!pattern) throw new Error('trigger pattern is required');

  const target = trigger.target.trim();
  if (!target) throw new Error('trigger target is required');

  const debounce = normalizeDebounce(trigger.debounce);
  return debounce === DEFAULT_DEBOUNCE_MS
    ? { pattern, action, target }
    : { pattern, action, target, debounce };
}

function normalizeDebounce(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_DEBOUNCE_MS;
  }
  return Math.floor(value);
}

function normalizePattern(value: string | Buffer | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : value.toString('utf8');
  return text.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function normalizeWatchedPath(filename: string | Buffer | null): string {
  const normalized = normalizePattern(filename);
  if (!normalized || normalized.startsWith(`${TRIGGERS_DIR}/`)) return '';
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function isFileTrigger(value: unknown): value is FileTrigger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const trigger = value as Record<string, unknown>;
  return (
    typeof trigger.pattern === 'string' &&
    VALID_ACTIONS.has(trigger.action as FileTrigger['action']) &&
    typeof trigger.target === 'string' &&
    (trigger.debounce === undefined ||
      (typeof trigger.debounce === 'number' &&
        Number.isFinite(trigger.debounce) &&
        trigger.debounce >= 0))
  );
}
