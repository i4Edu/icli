import { theme } from '../ui/theme.js';

export interface OutcomeRecord {
  id: string;
  strategy: string;
  context: string;
  result: 'success' | 'failure' | 'partial';
  score: number;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LearnedPreference {
  context: string;
  preferredStrategy: string;
  confidence: number;
  sampleSize: number;
}

export interface LearningStats {
  totalRecords: number;
  successRate: number;
  topStrategies: Array<{ strategy: string; successRate: number }>;
}

export class OutcomeLearner {
  private readonly records = new Map<string, OutcomeRecord>();

  record(outcome: OutcomeRecord): void {
    this.records.set(outcome.id, sanitizeRecord(outcome));
  }

  getPreference(context: string): LearnedPreference | undefined {
    const matches = this.findMatchingRecords(context);
    if (matches.length === 0) return undefined;

    const strategies = summarizeStrategies(matches);
    const preferred = strategies[0];
    if (!preferred) return undefined;

    const support = preferred.count / matches.length;
    return {
      context,
      preferredStrategy: preferred.strategy,
      confidence: round(clamp(preferred.averageScore * 0.7 + support * 0.3)),
      sampleSize: matches.length,
    };
  }

  getStats(): LearningStats {
    const records = this.exportData();
    const strategies = summarizeStrategies(records);
    return {
      totalRecords: records.length,
      successRate: round(
        records.reduce((sum, record) => sum + outcomeValue(record), 0) /
          Math.max(records.length, 1),
      ),
      topStrategies: strategies.map((item) => ({
        strategy: item.strategy,
        successRate: round(item.averageScore),
      })),
    };
  }

  prune(olderThan?: string | Date | number): number {
    if (olderThan === undefined) return 0;

    const cutoff =
      olderThan instanceof Date
        ? olderThan.getTime()
        : typeof olderThan === 'number'
          ? olderThan
          : new Date(olderThan).getTime();

    if (!Number.isFinite(cutoff)) return 0;

    let removed = 0;
    for (const [id, record] of this.records.entries()) {
      if (new Date(record.timestamp).getTime() < cutoff) {
        this.records.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  exportData(): OutcomeRecord[] {
    return [...this.records.values()]
      .map((record) => ({
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
      }))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  importData(records: OutcomeRecord[]): number {
    for (const record of records) {
      this.record(record);
    }
    return this.records.size;
  }

  suggestStrategy(context: string): string | undefined {
    return this.getPreference(context)?.preferredStrategy;
  }

  private findMatchingRecords(context: string): OutcomeRecord[] {
    const normalizedContext = normalize(context);
    return this.exportData().filter((record) => {
      const normalizedRecordContext = normalize(record.context);
      return (
        normalizedRecordContext.includes(normalizedContext) ||
        normalizedContext.includes(normalizedRecordContext) ||
        tokenOverlap(normalizedContext, normalizedRecordContext) >= 0.5
      );
    });
  }
}

export function formatLearningStats(stats: LearningStats): string {
  return [
    `${theme.badge('LEARN')} ${theme.assistant(`${stats.totalRecords} records`)}`,
    `${theme.dim('success rate:')} ${Math.round(stats.successRate * 100)}%`,
    `${theme.dim('top strategies:')}`,
    ...stats.topStrategies.map(
      (entry, index) =>
        `  ${theme.hl(`${index + 1}.`)} ${entry.strategy} (${Math.round(entry.successRate * 100)}%)`,
    ),
  ].join('\n');
}

function sanitizeRecord(record: OutcomeRecord): OutcomeRecord {
  return {
    ...record,
    score: clamp(record.score),
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function summarizeStrategies(records: OutcomeRecord[]) {
  const summary = new Map<
    string,
    { strategy: string; totalScore: number; count: number; averageScore: number }
  >();

  for (const record of records) {
    const current = summary.get(record.strategy) ?? {
      strategy: record.strategy,
      totalScore: 0,
      count: 0,
      averageScore: 0,
    };
    current.totalScore += outcomeValue(record);
    current.count += 1;
    current.averageScore = current.totalScore / current.count;
    summary.set(record.strategy, current);
  }

  return [...summary.values()].sort(
    (left, right) =>
      right.averageScore - left.averageScore ||
      right.count - left.count ||
      left.strategy.localeCompare(right.strategy),
  );
}

function outcomeValue(record: OutcomeRecord): number {
  if (record.result === 'success') return clamp(record.score);
  if (record.result === 'partial') return clamp(Math.min(record.score, 0.75));
  return 0;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/u).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/u).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
