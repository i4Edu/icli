import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { buildContextBreakdown, type ContextBreakdown, type ContextSource } from './context-cmd.js';

interface BucketSummary {
  label: 'System' | 'History' | 'Files' | 'Free';
  tokens: number;
  details: string;
}

export function showContextUsage(session: Session): string {
  const breakdown = buildContextBreakdown(session);
  const buckets = summarizeContextUsage(breakdown);
  const usedPct = breakdown.budget > 0 ? Math.round((breakdown.total / breakdown.budget) * 100) : 0;
  const lines = [
    theme.brand('Context usage'),
    `  ${renderProgressBar(breakdown.total, breakdown.budget, 16)} ${usedPct}% (${formatTokenAmount(breakdown.total)} / ${formatTokenAmount(breakdown.budget)} tokens)`,
    `  ${buckets.map((bucket) => `${bucket.label}: ${formatTokenAmount(bucket.tokens)}`).join(' | ')}`,
    '',
    theme.brand('Breakdown'),
    ...buckets.map(
      (bucket) =>
        `  ${bucket.label.padEnd(7)} ${formatTokenAmount(bucket.tokens).padStart(6)}  ${theme.dim(bucket.details)}`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function summarizeContextUsage(breakdown: ContextBreakdown): BucketSummary[] {
  const systemTokens = sumByType(breakdown.sources, ['system', 'memory']);
  const historyTokens = sumByType(breakdown.sources, ['history']);
  const fileTokens = sumByType(breakdown.sources, ['file', 'pinned', 'git', 'skill']);
  return [
    { label: 'System', tokens: systemTokens, details: 'prompt, style, conventions, memory' },
    { label: 'History', tokens: historyTokens, details: 'conversation turns and tool output' },
    { label: 'Files', tokens: fileTokens, details: 'referenced, pinned, and git context' },
    { label: 'Free', tokens: breakdown.remaining, details: 'remaining context budget' },
  ];
}

function sumByType(sources: ContextSource[], types: ContextSource['type'][]): number {
  return sources.reduce(
    (sum, source) => (types.includes(source.type) ? sum + source.tokens : sum),
    0,
  );
}

function renderProgressBar(used: number, total: number, width: number): string {
  const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, used / total));
  const fill = Math.round(ratio * width);
  return `[${'█'.repeat(fill)}${'░'.repeat(Math.max(0, width - fill))}]`;
}

function formatTokenAmount(tokens: number): string {
  if (tokens >= 1000) {
    const compact = (tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1);
    return `${compact.replace(/\.0$/, '')}k`;
  }
  return `${tokens}`;
}
