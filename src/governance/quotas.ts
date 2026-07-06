import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface Quota {
  scope: 'user' | 'project' | 'org';
  limit: number;
  used: number;
  period: 'daily' | 'weekly' | 'monthly';
  type: 'tokens' | 'cost';
}

export interface QuotaStatus {
  quota: Quota;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
  resetAt: string;
}

const QUOTAS_FILE = path.join('.icopilot', 'quotas.yaml');

export class QuotaManager {
  private quotas: Quota[] = [];
  private quotaPath: string;

  constructor(
    quotaPath = defaultQuotaPath(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.quotaPath = path.resolve(quotaPath);
    this.loadQuotas(this.quotaPath);
  }

  checkQuota(scope: Quota['scope'], type: Quota['type']): QuotaStatus | null {
    const quota = this.findQuota(scope, type);
    return quota ? toStatus(quota, this.now()) : null;
  }

  recordUsage(scope: Quota['scope'], type: Quota['type'], amount: number): QuotaStatus | null {
    const quota = this.findQuota(scope, type);
    if (!quota) return null;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('usage amount must be a non-negative number');
    }
    quota.used = roundValue(quota.used + amount);
    this.persist();
    return toStatus(quota, this.now());
  }

  getStatus(scope?: Quota['scope']): QuotaStatus[] {
    return this.quotas
      .filter((quota) => !scope || quota.scope === scope)
      .map((quota) => toStatus(quota, this.now()));
  }

  resetQuota(scope: Quota['scope'], type: Quota['type']): QuotaStatus | null {
    const quota = this.findQuota(scope, type);
    if (!quota) return null;
    quota.used = 0;
    this.persist();
    return toStatus(quota, this.now());
  }

  loadQuotas(quotaPath = this.quotaPath): Quota[] {
    this.quotaPath = path.resolve(quotaPath);
    try {
      if (!fs.existsSync(this.quotaPath)) {
        this.quotas = [];
        return [];
      }
      const parsed = parse(fs.readFileSync(this.quotaPath, 'utf8')) as unknown;
      this.quotas = normalizeQuotaFile(parsed);
      return this.quotas.map((quota) => ({ ...quota }));
    } catch {
      this.quotas = [];
      return [];
    }
  }

  private findQuota(scope: Quota['scope'], type: Quota['type']): Quota | undefined {
    return this.quotas.find((quota) => quota.scope === scope && quota.type === type);
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.quotaPath), { recursive: true });
    fs.writeFileSync(this.quotaPath, stringify({ quotas: this.quotas }), 'utf8');
  }
}

export function formatQuotaStatus(statuses: QuotaStatus[]): string {
  if (statuses.length === 0) {
    return `${theme.brand('Quotas')}\n  ${theme.dim('No quotas configured.')}\n`;
  }

  const lines = statuses.map((status) => {
    const usage = `${formatNumber(status.quota.used)}/${formatNumber(status.quota.limit)}`;
    const remaining = formatNumber(status.remaining);
    const percent = `${status.percentUsed.toFixed(1)}%`;
    const marker = status.exceeded ? theme.err('exceeded') : theme.ok('within');
    return `  ${theme.hl(`${status.quota.scope}:${status.quota.type}`)} ${usage} ${theme.dim(`(${percent}, remaining ${remaining}, resets ${status.resetAt})`)} ${marker}`;
  });

  return `${theme.brand('Quotas')}\n${lines.join('\n')}\n`;
}

function defaultQuotaPath(cwd = config.cwd): string {
  return path.join(cwd, QUOTAS_FILE);
}

function normalizeQuotaFile(value: unknown): Quota[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.quotas)
      ? value.quotas
      : [];
  return items.flatMap((entry) => {
    const normalized = normalizeQuota(entry);
    return normalized ? [normalized] : [];
  });
}

function normalizeQuota(value: unknown): Quota | null {
  if (!isRecord(value)) return null;
  const scope = value.scope;
  const type = value.type;
  const period = value.period;
  const limit = normalizeNumber(value.limit);
  const used = normalizeNumber(value.used) ?? 0;

  if (
    (scope !== 'user' && scope !== 'project' && scope !== 'org') ||
    (type !== 'tokens' && type !== 'cost') ||
    (period !== 'daily' && period !== 'weekly' && period !== 'monthly') ||
    limit === undefined
  ) {
    return null;
  }

  return {
    scope,
    limit: roundValue(limit),
    used: roundValue(Math.max(0, used)),
    period,
    type,
  };
}

function toStatus(quota: Quota, now: Date): QuotaStatus {
  const remaining = roundValue(Math.max(0, quota.limit - quota.used));
  const percentUsed = quota.limit > 0 ? roundValue((quota.used / quota.limit) * 100) : 100;
  return {
    quota: { ...quota },
    remaining,
    percentUsed,
    exceeded: quota.used > quota.limit,
    resetAt: nextResetAt(now, quota.period).toISOString(),
  };
}

function nextResetAt(now: Date, period: Quota['period']): Date {
  const next = new Date(now.getTime());
  next.setUTCHours(0, 0, 0, 0);
  if (period === 'daily') {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (period === 'weekly') {
    const day = next.getUTCDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    return next;
  }
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  return next;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
