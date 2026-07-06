import { theme } from '../ui/theme.js';
import { formatUsd } from '../util/cost.js';

export interface TokenAttribution {
  source: string;
  tokens: number;
  cost: number;
  percentage: number;
}

export interface AttributionReport {
  attributions: TokenAttribution[];
  totalTokens: number;
  totalCost: number;
  topDrivers: string[];
}

export class TokenAttributionTracker {
  private readonly totals = new Map<string, { tokens: number; cost: number }>();

  record(source: string, tokens: number, cost: number): void {
    const current = this.totals.get(source) ?? { tokens: 0, cost: 0 };
    current.tokens += Math.max(0, Math.floor(tokens));
    current.cost += Math.max(0, cost);
    this.totals.set(source, current);
  }

  getReport(): AttributionReport {
    const totalTokens = [...this.totals.values()].reduce((sum, item) => sum + item.tokens, 0);
    const totalCost = [...this.totals.values()].reduce((sum, item) => sum + item.cost, 0);
    const attributions = [...this.totals.entries()]
      .map(([source, item]) => ({
        source,
        tokens: item.tokens,
        cost: item.cost,
        percentage: totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source));

    return {
      attributions,
      totalTokens,
      totalCost,
      topDrivers: attributions.slice(0, 3).map((item) => item.source),
    };
  }

  reset(): void {
    this.totals.clear();
  }
}

export function formatAttributionReport(report: AttributionReport): string {
  const lines = [
    theme.brand('Token attribution'),
    `  total tokens: ${theme.hl(String(report.totalTokens))}`,
    `  total cost:   ${theme.ok(formatUsd(report.totalCost))}`,
    `  top drivers:  ${report.topDrivers.length > 0 ? theme.warn(report.topDrivers.join(', ')) : theme.dim('none')}`,
    '',
  ];

  if (report.attributions.length === 0) {
    lines.push(`  ${theme.dim('No attribution data recorded.')}`, '');
    return lines.join('\n');
  }

  lines.push(theme.brand('By source'));
  for (const attribution of report.attributions) {
    lines.push(
      `  ${attribution.source.padEnd(18)} ${theme.hl(String(attribution.tokens).padStart(6))} tk  ${theme.ok(formatUsd(attribution.cost)).padStart(10)}  ${theme.dim(`${attribution.percentage.toFixed(1)}%`)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
