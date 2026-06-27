import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MetricsCollector,
  formatDuration,
  metricsCommand,
} from '../../src/commands/metrics-cmd.js';

describe('MetricsCollector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records metrics and summarizes tracked values', () => {
    const collector = new MetricsCollector();

    collector.record('custom', 42, 'count');
    vi.advanceTimersByTime(200);
    collector.recordResponseTime(120);
    collector.recordResponseTime(180);
    collector.recordTokenThroughput(24);
    collector.recordTokenThroughput(36);
    collector.recordToolCall('search', 80);
    collector.recordToolCall('lint', 120);
    vi.advanceTimersByTime(1800);

    expect(collector.summary()).toEqual({
      avgResponseMs: 150,
      avgTokensPerSec: 30,
      totalTurns: 2,
      avgToolCallMs: 100,
      sessionDurationMs: 2000,
    });
  });

  it('resets tracked data and session timing', () => {
    const collector = new MetricsCollector();

    collector.recordResponseTime(250);
    collector.recordTokenThroughput(40);
    collector.recordToolCall('grep', 75);
    vi.advanceTimersByTime(500);

    collector.reset();
    expect(collector.summary()).toEqual({
      avgResponseMs: 0,
      avgTokensPerSec: 0,
      totalTurns: 0,
      avgToolCallMs: 0,
      sessionDurationMs: 0,
    });

    vi.advanceTimersByTime(250);
    expect(collector.summary().sessionDurationMs).toBe(250);
  });
});

describe('formatDuration', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats longer durations in seconds', () => {
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(1000)).toBe('1s');
  });
});

describe('metricsCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders summary metrics and the top-5 slowest tool calls', () => {
    const collector = new MetricsCollector();

    collector.recordResponseTime(1250);
    collector.recordTokenThroughput(32.45);
    collector.recordToolCall('search', 800);
    collector.recordToolCall('lint', 300);
    collector.recordToolCall('test', 1200);
    collector.recordToolCall('summary', 950);
    collector.recordToolCall('profile', 450);
    collector.recordToolCall('stats', 150);
    vi.advanceTimersByTime(1500);

    const output = metricsCommand(collector);

    expect(output).toContain('Performance metrics');
    expect(output).toContain('avg response time: 1.3s');
    expect(output).toContain('avg throughput:    32.5 tokens/s');
    expect(output).toContain('avg tool call:     642ms');
    expect(output).toContain('total turns:       1');
    expect(output).toContain('session duration:  1.5s');
    expect(output).toContain('Top-5 slowest tool calls');
    expect(output).toContain('test 1.2s');
    expect(output).toContain('summary 950ms');
    expect(output).toContain('search 800ms');
    expect(output).toContain('profile 450ms');
    expect(output).toContain('lint 300ms');
    expect(output).not.toContain('stats 150ms');
    expect(output.indexOf('test 1.2s')).toBeLessThan(output.indexOf('search 800ms'));
  });
});
