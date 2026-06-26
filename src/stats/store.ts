import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Stats {
  firstSeen: string;
  lastUpdate: string;
  tokensIn: number;
  tokensOut: number;
  toolCalls: Record<string, number>;
  commands: Record<string, number>;
  sessions: number;
}

let defaultFirstSeen: string | undefined;

export function statsPath(): string {
  return process.env.ICOPILOT_STATS_PATH || path.join(os.homedir(), '.icopilot', 'stats.json');
}

export function loadStats(): Stats {
  const file = statsPath();
  if (fs.existsSync(file)) {
    try {
      return normalizeStats(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return defaultStats();
    }
  }
  return defaultStats();
}

export function saveStats(s: Stats): void {
  const file = statsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalizeStats(s), null, 2)}\n`, 'utf8');
}

export function recordTokens(input: number, output: number): Stats {
  const s = touch(loadStats());
  s.tokensIn += count(input);
  s.tokensOut += count(output);
  saveStats(s);
  return s;
}

export function recordToolCall(name: string): Stats {
  const s = touch(loadStats());
  increment(s.toolCalls, name);
  saveStats(s);
  return s;
}

export function recordCommand(name: string): Stats {
  const s = touch(loadStats());
  increment(s.commands, name);
  saveStats(s);
  return s;
}

export function recordSession(): Stats {
  const s = touch(loadStats());
  s.sessions += 1;
  saveStats(s);
  return s;
}

export function resetStats(): void {
  const now = new Date().toISOString();
  saveStats(zeroStats(now));
}

function defaultStats(): Stats {
  defaultFirstSeen ??= new Date().toISOString();
  return zeroStats(defaultFirstSeen);
}

function zeroStats(now: string): Stats {
  return {
    firstSeen: now,
    lastUpdate: now,
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: {},
    commands: {},
    sessions: 0,
  };
}

function normalizeStats(value: unknown): Stats {
  const source = typeof value === 'object' && value !== null ? (value as Partial<Stats>) : {};
  const fallback = defaultStats();
  return {
    firstSeen: typeof source.firstSeen === 'string' ? source.firstSeen : fallback.firstSeen,
    lastUpdate: typeof source.lastUpdate === 'string' ? source.lastUpdate : fallback.lastUpdate,
    tokensIn: count(source.tokensIn),
    tokensOut: count(source.tokensOut),
    toolCalls: normalizeCounter(source.toolCalls),
    commands: normalizeCounter(source.commands),
    sessions: count(source.sessions),
  };
}

function normalizeCounter(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.length > 0)
      .map(([key, val]) => [key, count(val)]),
  );
}

function touch(s: Stats): Stats {
  s.lastUpdate = new Date().toISOString();
  return s;
}

function increment(target: Record<string, number>, name: string): void {
  const key = name.trim();
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
