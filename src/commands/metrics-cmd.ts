import { theme } from '../ui/theme.js';

export interface Metric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export interface MetricsSummary {
  avgResponseMs: number;
  avgTokensPerSec: number;
  totalTurns: number;
  avgToolCallMs: number;
  sessionDurationMs: number;
}

export class MetricsCollector {
  private readonly metrics: Metric[] = [];
  private readonly responseTimes: Metric[] = [];
  private readonly tokenThroughputs: Metric[] = [];
  private readonly toolCalls: Metric[] = [];
  private sessionStartedAt = Date.now();

  record(name: string, value: number, unit: string): void {
    const metric: Metric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
    };
    this.metrics.push(metric);
  }

  recordResponseTime(ms: number): void {
    const metric = this.createMetric('response', ms, 'ms');
    this.responseTimes.push(metric);
    this.metrics.push(metric);
  }

  recordTokenThroughput(tokensPerSec: number): void {
    const metric = this.createMetric('throughput', tokensPerSec, 'tokens/s');
    this.tokenThroughputs.push(metric);
    this.metrics.push(metric);
  }

  recordToolCall(name: string, ms: number): void {
    const metric = this.createMetric(name, ms, 'ms');
    this.toolCalls.push(metric);
    this.metrics.push(metric);
  }

  summary(): MetricsSummary {
    return {
      avgResponseMs: average(this.responseTimes),
      avgTokensPerSec: average(this.tokenThroughputs),
      totalTurns: this.responseTimes.length,
      avgToolCallMs: average(this.toolCalls),
      sessionDurationMs: Math.max(0, Date.now() - this.sessionStartedAt),
    };
  }

  topSlowestToolCalls(limit = 5): Metric[] {
    return [...this.toolCalls]
      .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))
      .slice(0, limit);
  }

  reset(): void {
    this.metrics.length = 0;
    this.responseTimes.length = 0;
    this.tokenThroughputs.length = 0;
    this.toolCalls.length = 0;
    this.sessionStartedAt = Date.now();
  }

  private createMetric(name: string, value: number, unit: string): Metric {
    return {
      name,
      value,
      unit,
      timestamp: Date.now(),
    };
  }
}

export function metricsCommand(collector: MetricsCollector): string {
  const summary = collector.summary();
  const slowestToolCalls = collector.topSlowestToolCalls(5);

  return [
    theme.brand('Performance metrics'),
    `  avg response time: ${theme.hl(formatDuration(summary.avgResponseMs))}`,
    `  avg throughput:    ${theme.hl(formatTokensPerSec(summary.avgTokensPerSec))}`,
    `  avg tool call:     ${theme.hl(formatDuration(summary.avgToolCallMs))}`,
    `  total turns:       ${theme.hl(String(summary.totalTurns))}`,
    `  session duration:  ${theme.hl(formatDuration(summary.sessionDurationMs))}`,
    '',
    theme.brand('Top-5 slowest tool calls'),
    slowestToolCalls.length > 0
      ? slowestToolCalls
          .map(
            (metric, index) =>
              `  ${theme.dim(`${index + 1}.`)} ${metric.name} ${theme.hl(formatDuration(metric.value))}`,
          )
          .join('\n')
      : `  ${theme.dim('none recorded yet')}`,
    '',
  ].join('\n');
}

export function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safeMs < 1000) return `${Math.round(safeMs)}ms`;
  return `${(safeMs / 1000).toFixed(1).replace(/\.0$/, '')}s`;
}

function average(metrics: Metric[]): number {
  if (metrics.length === 0) return 0;
  const total = metrics.reduce((sum, metric) => sum + metric.value, 0);
  return total / metrics.length;
}

function formatTokensPerSec(tokensPerSec: number): string {
  const safe = Number.isFinite(tokensPerSec) ? Math.max(0, tokensPerSec) : 0;
  return `${safe.toFixed(1)} tokens/s`;
}
