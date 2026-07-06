import { theme } from '../ui/theme.js';

export interface TraceEntry {
  id: string;
  timestamp: string;
  type: 'model' | 'tool' | 'command' | 'system';
  name: string;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  tokenCount: number;
  parentId?: string;
}

export interface TraceSession {
  entries: TraceEntry[];
  startedAt: string;
  totalDuration: number;
  totalTokens: number;
}

type TraceStepInput = Omit<TraceEntry, 'timestamp'> & { timestamp?: string };

export class TraceRecorder {
  private trace: TraceSession | null = null;

  start(startedAt = new Date().toISOString()): void {
    this.trace = {
      entries: [],
      startedAt,
      totalDuration: 0,
      totalTokens: 0,
    };
  }

  recordStep(entry: TraceEntry | TraceStepInput): void {
    if (!this.trace) {
      this.start();
    }

    const normalized: TraceEntry = {
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    this.trace!.entries.push(normalized);
    this.trace!.totalDuration += normalized.durationMs;
    this.trace!.totalTokens += normalized.tokenCount;
  }

  stop(): TraceSession {
    if (!this.trace) {
      this.start();
    }
    return this.getTrace();
  }

  getTrace(): TraceSession {
    if (!this.trace) {
      this.start();
    }

    return {
      startedAt: this.trace!.startedAt,
      totalDuration: this.trace!.totalDuration,
      totalTokens: this.trace!.totalTokens,
      entries: this.trace!.entries.map((entry) => ({ ...entry })),
    };
  }

  clear(): void {
    this.trace = null;
  }
}

export function formatTrace(trace: TraceSession): string {
  const lines = [
    theme.brand('Reasoning trace'),
    `  started: ${theme.dim(trace.startedAt)}`,
    `  duration: ${theme.hl(formatDuration(trace.totalDuration))}`,
    `  tokens: ${theme.hl(String(trace.totalTokens))}`,
    '',
  ];

  if (trace.entries.length === 0) {
    lines.push(`  ${theme.dim('No trace entries recorded.')}`, '');
    return lines.join('\n');
  }

  lines.push(theme.brand('Timeline'));
  trace.entries.forEach((entry, index) => {
    const connector = index === trace.entries.length - 1 ? '└─' : '├─';
    const badge = formatType(entry.type);
    const parent = entry.parentId ? ` ${theme.dim(`↳ ${entry.parentId}`)}` : '';
    lines.push(
      `  ${connector} ${badge} ${theme.hl(entry.name)}${parent} ${theme.dim(`@ ${entry.timestamp}`)}`,
    );
    lines.push(
      `     in: ${entry.inputSummary || theme.dim('n/a')} ${theme.dim(`· ${formatDuration(entry.durationMs)} · ${entry.tokenCount} tk`)}`,
    );
    lines.push(`     out: ${entry.outputSummary || theme.dim('n/a')}`);
  });
  lines.push('');

  return lines.join('\n');
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function formatType(type: TraceEntry['type']): string {
  switch (type) {
    case 'model':
      return theme.badge('MODEL');
    case 'tool':
      return theme.badge('TOOL');
    case 'command':
      return theme.badge('CMD');
    case 'system':
      return theme.badge('SYS');
  }
}
