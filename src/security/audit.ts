import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export type AuditResult = 'success' | 'failure' | 'denied';
export type AuditExportFormat = 'jsonl' | 'json';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  tool?: string;
  command?: string;
  args?: unknown;
  result: AuditResult;
  user?: string;
  duration?: number;
  details?: string;
}

export interface AuditFilter {
  from?: string | Date;
  to?: string | Date;
  action?: string;
  tool?: string;
  result?: AuditResult;
}

export interface AuditStats {
  total: number;
  success: number;
  failure: number;
  denied: number;
  firstEntry?: string;
  lastEntry?: string;
  avgDuration?: number;
  byAction: Record<string, number>;
  byTool: Record<string, number>;
}

export interface AuditLogInput extends Partial<Pick<AuditEntry, 'id' | 'timestamp' | 'user'>> {
  action: string;
  tool?: string;
  command?: string;
  args?: unknown;
  result: AuditResult;
  duration?: number;
  details?: string;
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function auditLogPath(): string {
  return process.env.ICOPILOT_AUDIT_PATH || path.join(os.homedir(), '.icopilot', 'audit.log');
}

export class AuditLogger {
  constructor(private readonly filePath = auditLogPath()) {}

  log(entry: AuditLogInput): AuditEntry {
    const normalized = normalizeEntry(entry);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  }

  query(filter: AuditFilter = {}): AuditEntry[] {
    return this.readEntries().filter((entry) => matchesFilter(entry, filter));
  }

  getRecent(n = 20): AuditEntry[] {
    const limit = normalizeLimit(n, 20);
    return this.readEntries().slice(-limit).reverse();
  }

  export(targetPath?: string, format: AuditExportFormat = 'jsonl'): string {
    const resolvedFormat = normalizeFormat(format, targetPath);
    const resolvedPath = path.resolve(targetPath || defaultExportPath(resolvedFormat));
    const entries = this.readEntries();
    const body =
      resolvedFormat === 'json'
        ? `${JSON.stringify(entries, null, 2)}\n`
        : entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, body, 'utf8');
    return resolvedPath;
  }

  rotate(maxAge = DEFAULT_MAX_AGE_MS): number {
    const entries = this.readEntries();
    if (entries.length === 0) return 0;
    const cutoff = Date.now() - normalizeMaxAge(maxAge);
    const kept = entries.filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    const removed = entries.length - kept.length;
    if (removed === 0) return 0;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const nextBody = kept.map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(this.filePath, nextBody ? `${nextBody}\n` : '', 'utf8');
    return removed;
  }

  getStats(): AuditStats {
    const entries = this.readEntries();
    const byAction: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let success = 0;
    let failure = 0;
    let denied = 0;
    let durationTotal = 0;
    let durationCount = 0;

    for (const entry of entries) {
      increment(byAction, entry.action);
      if (entry.tool) increment(byTool, entry.tool);
      if (entry.result === 'success') success += 1;
      else if (entry.result === 'failure') failure += 1;
      else denied += 1;
      if (typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0) {
        durationTotal += entry.duration;
        durationCount += 1;
      }
    }

    return {
      total: entries.length,
      success,
      failure,
      denied,
      firstEntry: entries[0]?.timestamp,
      lastEntry: entries[entries.length - 1]?.timestamp,
      avgDuration: durationCount ? Math.round(durationTotal / durationCount) : undefined,
      byAction,
      byTool,
    };
  }

  private readEntries(): AuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [normalizeStoredEntry(JSON.parse(line) as unknown)];
        } catch {
          return [];
        }
      });
  }
}

function normalizeEntry(entry: AuditLogInput): AuditEntry {
  return {
    id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : crypto.randomUUID(),
    timestamp: normalizeTimestamp(entry.timestamp),
    action: String(entry.action || 'tool.execute').trim() || 'tool.execute',
    tool: normalizeOptionalString(entry.tool),
    command: normalizeOptionalString(entry.command),
    args: sanitizeArgs(entry.args),
    result: normalizeResult(entry.result),
    user: normalizeOptionalString(entry.user) || defaultUser(),
    duration: normalizeDuration(entry.duration),
    details: normalizeOptionalString(entry.details),
  };
}

function normalizeStoredEntry(entry: unknown): AuditEntry {
  const source = (entry && typeof entry === 'object' ? entry : {}) as Partial<AuditEntry>;
  return normalizeEntry({
    id: source.id,
    timestamp: source.timestamp,
    action: typeof source.action === 'string' ? source.action : 'tool.execute',
    tool: source.tool,
    command: source.command,
    args: source.args,
    result: normalizeResult(source.result),
    user: source.user,
    duration: source.duration,
    details: source.details,
  });
}

function normalizeTimestamp(value: string | Date | undefined): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeResult(value: AuditResult | undefined): AuditResult {
  return value === 'success' || value === 'failure' || value === 'denied' ? value : 'failure';
}

function normalizeDuration(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultUser(): string | undefined {
  return normalizeOptionalString(process.env.ICOPILOT_AUDIT_USER || process.env.USERNAME || process.env.USER);
}

function sanitizeArgs(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (depth >= 4) return '[truncated depth]';
  if (typeof value === 'string') {
    return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated ${value.length - 4000} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeArgs(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, sanitizeArgs(item, depth + 1)]),
    );
  }
  return String(value);
}

function matchesFilter(entry: AuditEntry, filter: AuditFilter): boolean {
  const from = toTimestamp(filter.from);
  const to = toTimestamp(filter.to);
  const entryTime = Date.parse(entry.timestamp);
  if (from !== undefined && (!Number.isFinite(entryTime) || entryTime < from)) return false;
  if (to !== undefined && (!Number.isFinite(entryTime) || entryTime > to)) return false;
  if (filter.result && entry.result !== filter.result) return false;
  if (filter.action && entry.action.toLowerCase() !== filter.action.toLowerCase()) return false;
  if (filter.tool && (entry.tool || '').toLowerCase() !== filter.tool.toLowerCase()) return false;
  return true;
}

function toTimestamp(value: string | Date | undefined): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeMaxAge(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_AGE_MS;
  return Math.floor(value);
}

function normalizeFormat(format: AuditExportFormat, targetPath?: string): AuditExportFormat {
  if (targetPath?.toLowerCase().endsWith('.json')) return 'json';
  return format === 'json' ? 'json' : 'jsonl';
}

function defaultExportPath(format: AuditExportFormat): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return path.join(process.cwd(), `icopilot-audit-${stamp}.${format === 'json' ? 'json' : 'log'}`);
}

function increment(target: Record<string, number>, key: string): void {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}
