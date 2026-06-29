import { describe, expect, it, vi } from 'vitest';
import {
  ParallelAgentRunner,
  type AgentProgressEvent,
  type AgentTask,
} from '../../src/agents/parallel-runner.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ParallelAgentRunner', () => {
  it('runs agents concurrently up to the configured limit', async () => {
    let active = 0;
    let maxActive = 0;
    const progress: AgentProgressEvent[] = [];
    const tasks: AgentTask[] = [
      { name: 'alpha', type: 'task', prompt: 'first' },
      { name: 'beta', type: 'task', prompt: 'second' },
      { name: 'gamma', type: 'task', prompt: 'third' },
    ];

    const runner = new ParallelAgentRunner({
      model: 'gpt-test',
      concurrencyLimit: 2,
      executeTask: async (task) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(15);
        active -= 1;
        return `${task.prompt} done`;
      },
      onProgress: (event) => progress.push(event),
    });

    const { results, aggregated } = await runner.runParallel(tasks);

    expect(maxActive).toBe(2);
    expect(results).toEqual([
      expect.objectContaining({ name: 'alpha', status: 'success', output: 'first done' }),
      expect.objectContaining({ name: 'beta', status: 'success', output: 'second done' }),
      expect.objectContaining({ name: 'gamma', status: 'success', output: 'third done' }),
    ]);
    expect(progress.filter((event) => event.status === 'started')).toHaveLength(3);
    expect(progress.filter((event) => event.status === 'success')).toHaveLength(3);
    expect(aggregated.summary).toContain('first done');
  });

  it('returns per-agent errors without failing the whole batch', async () => {
    const runner = new ParallelAgentRunner({
      model: 'gpt-test',
      executeTask: async (task) => {
        if (task.name === 'broken') {
          throw new Error('boom');
        }
        return `${task.name} ok`;
      },
    });

    const { results, aggregated } = await runner.runParallel([
      { name: 'healthy', type: 'task', prompt: 'ok' },
      { name: 'broken', type: 'review', prompt: 'fail' },
    ]);

    expect(results[0]).toEqual(
      expect.objectContaining({ name: 'healthy', status: 'success', output: 'healthy ok' }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({ name: 'broken', status: 'error', output: 'boom' }),
    );
    expect(aggregated.summary).toContain('healthy ok');
    expect(aggregated.summary).not.toContain('boom');
  });

  it('aborts agents that exceed the timeout and falls back to the built-in system prompt', async () => {
    const executeTask = vi.fn(
      async (_task: AgentTask, options: { systemPrompt: string; signal: AbortSignal }) => {
        expect(options.systemPrompt).toContain('planning agent');
        await new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted by signal')), {
            once: true,
          });
        });
      },
    );

    const runner = new ParallelAgentRunner({
      model: 'gpt-test',
      timeoutMs: 20,
      executeTask,
    });

    const { results, aggregated } = await runner.runParallel([
      { name: 'planner', type: 'plan', prompt: 'outline the rollout' },
    ]);
    const [result] = results;

    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
    expect(result.output).toContain('Timed out after 20ms');
    expect(aggregated.summary).toContain('No agent results available');
  });
});
