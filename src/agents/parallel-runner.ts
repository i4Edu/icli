import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { activeProvider, client } from '../api/github-models.js';
import { getAgentConfig, type AgentType } from '../commands/agent-cmd.js';
import { aggregateResults, type AggregatedOutput } from './aggregator.js';

export interface AgentTask {
  name: string;
  type: AgentType | string;
  prompt: string;
  systemPrompt?: string;
}

export interface AgentResult {
  name: string;
  status: 'success' | 'error';
  output: string;
  duration: number;
}

export interface AgentProgressEvent {
  name: string;
  type: AgentTask['type'];
  status: 'queued' | 'started' | 'success' | 'error';
  completed: number;
  total: number;
  result?: AgentResult;
}

export interface ParallelAgentRunResult {
  results: AgentResult[];
  aggregated: AggregatedOutput;
}

export interface ParallelAgentRunnerOptions {
  model: string;
  concurrencyLimit?: number;
  timeoutMs?: number;
  onProgress?: (event: AgentProgressEvent) => void;
  executeTask?: (
    task: AgentTask,
    options: { model: string; signal: AbortSignal; systemPrompt: string },
  ) => Promise<string>;
}

const DEFAULT_CONCURRENCY_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 60_000;
const BUILT_IN_AGENT_TYPES = new Set<AgentType>(['explore', 'task', 'review', 'plan']);

export class ParallelAgentRunner {
  readonly concurrencyLimit: number;
  readonly timeoutMs: number;

  private readonly model: string;
  private readonly onProgress?: (event: AgentProgressEvent) => void;
  private readonly executeTask: NonNullable<ParallelAgentRunnerOptions['executeTask']>;

  constructor(options: ParallelAgentRunnerOptions) {
    this.model = options.model;
    this.concurrencyLimit = normalizePositiveInt(options.concurrencyLimit, DEFAULT_CONCURRENCY_LIMIT);
    this.timeoutMs = normalizePositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.onProgress = options.onProgress;
    this.executeTask = options.executeTask ?? defaultExecuteTask;
  }

  async runParallel(agents: AgentTask[]): Promise<ParallelAgentRunResult> {
    if (!agents.length) {
      return {
        results: [],
        aggregated: aggregateResults([]),
      };
    }

    const total = agents.length;
    let completed = 0;
    const limit = createConcurrencyLimiter(this.concurrencyLimit);

    for (const agent of agents) {
      this.onProgress?.({
        name: agent.name,
        type: agent.type,
        status: 'queued',
        completed,
        total,
      });
    }

    const executions = agents.map((agent) =>
      limit(async () => {
        this.onProgress?.({
          name: agent.name,
          type: agent.type,
          status: 'started',
          completed,
          total,
        });

        const result = await this.runSingle(agent);
        completed += 1;
        this.onProgress?.({
          name: agent.name,
          type: agent.type,
          status: result.status,
          completed,
          total,
          result,
        });
        return result;
      }),
    );

    const settled = await Promise.allSettled(executions);
    const results = settled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value;
      return {
        name: agents[index]?.name ?? `agent-${index + 1}`,
        status: 'error',
        output: formatError(entry.reason),
        duration: 0,
      } satisfies AgentResult;
    });
    return {
      results,
      aggregated: aggregateResults(
        results
          .filter((result) => result.status === 'success')
          .map((result) => ({
            name: result.name,
            output: result.output,
          })),
      ),
    };
  }

  private async runSingle(task: AgentTask): Promise<AgentResult> {
    const startedAt = Date.now();
    try {
      const output = await this.executeWithTimeout(task);
      return {
        name: task.name,
        status: 'success',
        output,
        duration: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        name: task.name,
        status: 'error',
        output: formatError(error),
        duration: Date.now() - startedAt,
      };
    }
  }

  private async executeWithTimeout(task: AgentTask): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      return await this.executeTask(task, {
        model: this.model,
        signal: controller.signal,
        systemPrompt: resolveSystemPrompt(task),
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`Timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function defaultExecuteTask(
  task: AgentTask,
  options: { model: string; signal: AbortSignal; systemPrompt: string },
): Promise<string> {
  const provider = activeProvider();
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: task.prompt },
  ];

  const response = await client().chat.completions.create(
    {
      model: options.model,
      messages,
      temperature: 0.2,
      ...(provider?.maxTokens ? { max_tokens: provider.maxTokens } : {}),
    },
    { signal: options.signal },
  );

  return response.choices[0]?.message?.content?.trim() || '';
}

function resolveSystemPrompt(task: AgentTask): string {
  const inlinePrompt = task.systemPrompt?.trim();
  if (inlinePrompt) return inlinePrompt;
  if (BUILT_IN_AGENT_TYPES.has(task.type as AgentType)) {
    return getAgentConfig(task.type as AgentType).systemPrompt;
  }
  return 'You are a specialized sub-agent. Complete the assigned task accurately and concisely.';
}

function createConcurrencyLimiter(limit: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount -= 1;
    const resume = queue.shift();
    resume?.();
  };

  return async function runLimited<T>(fn: () => Promise<T>): Promise<T> {
    if (activeCount >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    activeCount += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
