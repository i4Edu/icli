import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { config } from '../config.js';
import { auditLogPath } from './audit.js';
import { theme } from '../ui/theme.js';

export type RetentionTarget = 'sessions' | 'audit' | 'memory' | 'all';
export type ConcreteRetentionTarget = Exclude<RetentionTarget, 'all'>;

export interface RetentionPolicy {
  target: RetentionTarget;
  maxAgeDays: number;
  maxCount?: number;
  enabled: boolean;
}

export interface RetentionCandidate {
  target: ConcreteRetentionTarget;
  path: string;
  modifiedAt: string;
  ageDays: number;
  reasons: Array<'age' | 'count'>;
}

export interface RetentionTargetSummary {
  scanned: number;
  expired: number;
}

export interface RetentionPreview {
  policies: RetentionPolicy[];
  expired: RetentionCandidate[];
  totals: Record<ConcreteRetentionTarget, RetentionTargetSummary>;
}

export interface RetentionError {
  path: string;
  message: string;
}

export interface RetentionResult extends RetentionPreview {
  deleted: RetentionCandidate[];
  errors: RetentionError[];
}

interface RetentionItem {
  target: ConcreteRetentionTarget;
  path: string;
  modifiedAt: Date;
}

interface RetentionManagerOptions {
  configPath?: string;
  sessionDir?: string;
  auditPath?: string;
  memoryDir?: string;
  now?: () => Date;
}

const CONCRETE_TARGETS: ConcreteRetentionTarget[] = ['sessions', 'audit', 'memory'];

export function retentionConfigPath(): string {
  return path.join(os.homedir(), '.icopilot', 'retention.yaml');
}

export class RetentionManager {
  readonly configPath: string;
  private readonly sessionDir: string;
  private readonly auditPath: string;
  private readonly memoryDir: string;
  private readonly now: () => Date;

  constructor(options: RetentionManagerOptions = {}) {
    this.configPath = path.resolve(options.configPath ?? retentionConfigPath());
    this.sessionDir = path.resolve(options.sessionDir ?? config.sessionDir);
    this.auditPath = path.resolve(options.auditPath ?? auditLogPath());
    this.memoryDir = path.resolve(
      options.memoryDir ?? path.join(os.homedir(), '.icopilot', 'memory'),
    );
    this.now = options.now ?? (() => new Date());
  }

  loadPolicies(): RetentionPolicy[] {
    try {
      if (!fs.existsSync(this.configPath)) return [];
      const raw = parse(fs.readFileSync(this.configPath, 'utf8')) as unknown;
      const source = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { policies?: unknown }).policies)
          ? (raw as { policies: unknown[] }).policies
          : [];
      const normalized = source
        .map(normalizePolicy)
        .filter((policy): policy is RetentionPolicy => policy !== null);
      return dedupePolicies(normalized);
    } catch {
      return [];
    }
  }

  setPolicy(policy: RetentionPolicy): RetentionPolicy[] {
    const normalized = normalizePolicy(policy);
    if (!normalized) {
      throw new Error('Invalid retention policy.');
    }
    const next = dedupePolicies([
      ...this.loadPolicies().filter((entry) => entry.target !== normalized.target),
      normalized,
    ]);
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, stringify({ policies: next }), 'utf8');
    return next;
  }

  preview(): RetentionPreview {
    const expired = this.getExpired('all');
    return {
      policies: this.loadPolicies(),
      expired,
      totals: this.buildTotals(expired),
    };
  }

  enforce(): RetentionResult {
    const preview = this.preview();
    const deleted: RetentionCandidate[] = [];
    const errors: RetentionError[] = [];

    for (const candidate of preview.expired) {
      try {
        if (fs.existsSync(candidate.path)) {
          fs.rmSync(candidate.path, { force: true, recursive: false });
        }
        deleted.push(candidate);
      } catch (error: unknown) {
        errors.push({
          path: candidate.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ...preview,
      deleted,
      errors,
    };
  }

  getExpired(target: RetentionTarget): RetentionCandidate[] {
    if (target === 'all') {
      return CONCRETE_TARGETS.flatMap((entry) => this.getExpired(entry));
    }
    const policy = this.policyForTarget(target);
    if (!policy || !policy.enabled) return [];

    const items = this.itemsForTarget(target).sort(
      (left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
    );
    const cutoff = this.now().getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000;

    return items.flatMap((item, index) => {
      const reasons: Array<'age' | 'count'> = [];
      if (item.modifiedAt.getTime() <= cutoff) reasons.push('age');
      if (typeof policy.maxCount === 'number' && index >= policy.maxCount) reasons.push('count');
      if (reasons.length === 0) return [];
      return [
        {
          target: item.target,
          path: item.path,
          modifiedAt: item.modifiedAt.toISOString(),
          ageDays: ageDaysBetween(item.modifiedAt, this.now()),
          reasons,
        },
      ];
    });
  }

  private buildTotals(
    expired: RetentionCandidate[],
  ): Record<ConcreteRetentionTarget, RetentionTargetSummary> {
    return {
      sessions: {
        scanned: this.itemsForTarget('sessions').length,
        expired: expired.filter((entry) => entry.target === 'sessions').length,
      },
      audit: {
        scanned: this.itemsForTarget('audit').length,
        expired: expired.filter((entry) => entry.target === 'audit').length,
      },
      memory: {
        scanned: this.itemsForTarget('memory').length,
        expired: expired.filter((entry) => entry.target === 'memory').length,
      },
    };
  }

  private policyForTarget(target: ConcreteRetentionTarget): RetentionPolicy | null {
    const policies = this.loadPolicies();
    return (
      policies.find((policy) => policy.target === target) ??
      policies.find((policy) => policy.target === 'all') ??
      null
    );
  }

  private itemsForTarget(target: ConcreteRetentionTarget): RetentionItem[] {
    switch (target) {
      case 'sessions':
        return listFiles(this.sessionDir, target);
      case 'audit':
        return listSingleFile(this.auditPath, target);
      case 'memory':
        return listFiles(this.memoryDir, target);
    }
  }
}

export function formatPolicies(manager: RetentionManager): string {
  const policies = manager.loadPolicies();
  if (policies.length === 0) {
    return `${theme.brand('Retention policies')} ${theme.dim(manager.configPath)}\n  ${theme.dim('No retention policies configured.')}\n`;
  }

  const lines = policies.map((policy) => {
    const bits = [
      `age=${theme.hl(String(policy.maxAgeDays))}d`,
      typeof policy.maxCount === 'number' ? `count=${theme.hl(String(policy.maxCount))}` : null,
      policy.enabled ? theme.ok('enabled') : theme.warn('disabled'),
    ].filter(Boolean);
    return `  ${theme.hl(policy.target)}  ${bits.join('  ')}`;
  });
  return `${theme.brand('Retention policies')} ${theme.dim(manager.configPath)}\n${lines.join('\n')}\n`;
}

export function formatPreview(preview: RetentionPreview, manager: RetentionManager): string {
  const lines = [
    `${theme.brand('Retention preview')} ${theme.dim(manager.configPath)}`,
    ...formatTotals(preview.totals),
  ];

  if (preview.expired.length === 0) {
    lines.push('', theme.ok('No expired retention items.'));
    return `${lines.join('\n')}\n`;
  }

  lines.push('', theme.brand('Expired items'));
  for (const candidate of preview.expired) {
    lines.push(
      `  ${theme.hl(candidate.target)}  ${candidate.path} ${theme.dim(
        `(${candidate.ageDays.toFixed(1)}d, ${candidate.reasons.join('+')})`,
      )}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function formatResult(result: RetentionResult, manager: RetentionManager): string {
  const lines = [
    `${theme.brand('Retention enforce')} ${theme.dim(manager.configPath)}`,
    ...formatTotals(result.totals),
    '',
    `${theme.ok(`Deleted ${result.deleted.length} item${result.deleted.length === 1 ? '' : 's'}.`)}`,
  ];

  if (result.errors.length > 0) {
    lines.push(theme.warn(`Errors: ${result.errors.length}`));
    for (const error of result.errors) {
      lines.push(`  ${error.path} ${theme.dim(`(${error.message})`)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatTotals(totals: Record<ConcreteRetentionTarget, RetentionTargetSummary>): string[] {
  return CONCRETE_TARGETS.map((target) => {
    const summary = totals[target];
    return `  ${theme.hl(target)}  scanned=${summary.scanned}  expired=${summary.expired}`;
  });
}

function normalizePolicy(value: unknown): RetentionPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RetentionPolicy>;
  if (
    candidate.target !== 'sessions' &&
    candidate.target !== 'audit' &&
    candidate.target !== 'memory' &&
    candidate.target !== 'all'
  ) {
    return null;
  }
  const maxAgeDays = normalizeCount(candidate.maxAgeDays);
  if (maxAgeDays === null) return null;
  const maxCount =
    candidate.maxCount === undefined ? undefined : normalizeCount(candidate.maxCount);
  if (candidate.maxCount !== undefined && maxCount === null) return null;
  const normalizedMaxCount = maxCount ?? undefined;
  if (typeof candidate.enabled !== 'boolean') return null;
  return {
    target: candidate.target,
    maxAgeDays,
    maxCount: normalizedMaxCount,
    enabled: candidate.enabled,
  };
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : null;
}

function dedupePolicies(policies: RetentionPolicy[]): RetentionPolicy[] {
  const seen = new Set<RetentionTarget>();
  const ordered: RetentionPolicy[] = [];
  for (const target of ['sessions', 'audit', 'memory', 'all'] as RetentionTarget[]) {
    const policy = policies.find((entry) => entry.target === target);
    if (!policy || seen.has(policy.target)) continue;
    seen.add(policy.target);
    ordered.push(policy);
  }
  return ordered;
}

function listFiles(dirPath: string, target: ConcreteRetentionTarget): RetentionItem[] {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
    return fs.readdirSync(dirPath).flatMap((name) => {
      const filePath = path.join(dirPath, name);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return [];
        return [{ target, path: filePath, modifiedAt: stat.mtime }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function listSingleFile(filePath: string, target: ConcreteRetentionTarget): RetentionItem[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    return [{ target, path: filePath, modifiedAt: stat.mtime }];
  } catch {
    return [];
  }
}

function ageDaysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
