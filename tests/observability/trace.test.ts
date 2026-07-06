import { describe, expect, it } from 'vitest';
import { formatTrace, TraceRecorder } from '../../src/observability/trace.js';

describe('TraceRecorder', () => {
  it('records steps and aggregates totals', () => {
    const recorder = new TraceRecorder();
    recorder.start('2026-01-01T00:00:00.000Z');
    recorder.recordStep({
      id: 'step-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'command',
      name: '/trace show',
      inputSummary: 'show trace',
      outputSummary: 'rendered trace',
      durationMs: 120,
      tokenCount: 20,
    });
    recorder.recordStep({
      id: 'step-2',
      timestamp: '2026-01-01T00:00:02.000Z',
      type: 'tool',
      name: 'read_file',
      inputSummary: 'src/app.ts',
      outputSummary: 'loaded file contents',
      durationMs: 80,
      tokenCount: 12,
      parentId: 'step-1',
    });

    const trace = recorder.stop();

    expect(trace.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(trace.totalDuration).toBe(200);
    expect(trace.totalTokens).toBe(32);
    expect(trace.entries).toHaveLength(2);
    expect(trace.entries[1]?.parentId).toBe('step-1');
  });

  it('clears all recorded state', () => {
    const recorder = new TraceRecorder();
    recorder.start();
    recorder.recordStep({
      id: 'step-1',
      type: 'system',
      name: 'bootstrap',
      inputSummary: 'init',
      outputSummary: 'done',
      durationMs: 5,
      tokenCount: 1,
    });

    recorder.clear();

    const trace = recorder.getTrace();
    expect(trace.entries).toEqual([]);
    expect(trace.totalDuration).toBe(0);
    expect(trace.totalTokens).toBe(0);
  });

  it('formats a timeline view', () => {
    const recorder = new TraceRecorder();
    recorder.start('2026-01-01T00:00:00.000Z');
    recorder.recordStep({
      id: 'step-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'model',
      name: 'gpt-4o-mini',
      inputSummary: 'summarize repo',
      outputSummary: 'summary ready',
      durationMs: 350,
      tokenCount: 44,
    });

    const output = formatTrace(recorder.getTrace());

    expect(output).toContain('Reasoning trace');
    expect(output).toContain('Timeline');
    expect(output).toContain('gpt-4o-mini');
    expect(output).toContain('summary ready');
    expect(output).toContain('44');
  });
});
