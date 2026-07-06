import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface ExecutionTarget {
  id: string;
  name: string;
  type: 'ssh' | 'container' | 'cloud';
  host?: string;
  config?: Record<string, string | number | boolean>;
}

export interface ExecutionResult {
  targetId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ExecutionOptions {
  target: string;
  command: string;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface ExecutionStatus {
  target?: ExecutionTarget;
  running: boolean;
  connected: boolean;
  lastResult?: ExecutionResult;
}

interface RunnerRequest extends ExecutionOptions {
  targetConfig: ExecutionTarget;
}

interface RunnerResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type Runner = (request: RunnerRequest) => Promise<RunnerResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configPath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'execution-targets.json');
}

function normalizeTarget(value: unknown): ExecutionTarget | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !['ssh', 'container', 'cloud'].includes(String(value.type))
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type as ExecutionTarget['type'],
    host: typeof value.host === 'string' ? value.host : undefined,
    config: normalizeExecutionConfig(value.config),
  };
}

function normalizeExecutionConfig(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.entries(value).reduce<Record<string, string | number | boolean>>(
    (accumulator, [key, entry]) => {
      if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
        accumulator[key] = entry;
      }
      return accumulator;
    },
    {},
  );
}

async function defaultRunner(request: RunnerRequest): Promise<RunnerResponse> {
  const executable = process.platform === 'win32' ? 'cmd' : 'sh';
  const args =
    process.platform === 'win32' ? ['/d', '/s', '/c', request.command] : ['-lc', request.command];
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = request.timeout;
    const timer =
      typeof timeoutMs === 'number' && timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            resolve({
              exitCode: 124,
              stdout,
              stderr: `${stderr}command timed out after ${timeoutMs}ms`,
            });
          }, timeoutMs)
        : undefined;
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: error.message });
    });
  });
}

export class RemoteExecutor {
  private readonly targets = new Map<string, ExecutionTarget>();
  private readonly runningTargets = new Set<string>();
  private readonly lastResults = new Map<string, ExecutionResult>();
  private readonly runner: Runner;

  constructor(options: { runner?: Runner } = {}) {
    this.runner = options.runner ?? defaultRunner;
  }

  addTarget(target: ExecutionTarget): void {
    this.targets.set(target.id, {
      ...target,
      config: target.config ? { ...target.config } : undefined,
    });
  }

  removeTarget(id: string): boolean {
    this.lastResults.delete(id);
    this.runningTargets.delete(id);
    return this.targets.delete(id);
  }

  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const target = this.targets.get(options.target);
    if (!target) {
      throw new Error(`Unknown execution target: ${options.target}`);
    }
    const startedAt = Date.now();
    this.runningTargets.add(target.id);
    try {
      const outcome = await this.runner({ ...options, targetConfig: target });
      const result: ExecutionResult = {
        targetId: target.id,
        command: options.command,
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        durationMs: Date.now() - startedAt,
      };
      this.lastResults.set(target.id, result);
      return result;
    } finally {
      this.runningTargets.delete(target.id);
    }
  }

  listTargets(): ExecutionTarget[] {
    return [...this.targets.values()].map((target) => ({
      ...target,
      config: target.config ? { ...target.config } : undefined,
    }));
  }

  async testConnection(targetId: string): Promise<boolean> {
    const target = this.targets.get(targetId);
    if (!target) return false;
    if (target.type === 'ssh' && !target.host) return false;
    const result = await this.execute({
      target: targetId,
      command: 'printf connected',
      timeout: 2_000,
    });
    return result.exitCode === 0;
  }

  getStatus(targetId: string): ExecutionStatus {
    const target = this.targets.get(targetId);
    return {
      target: target
        ? {
            ...target,
            config: target.config ? { ...target.config } : undefined,
          }
        : undefined,
      running: this.runningTargets.has(targetId),
      connected: Boolean(target),
      lastResult: this.lastResults.get(targetId),
    };
  }
}

export function loadExecutionTargets(cwd = config.cwd): ExecutionTarget[] {
  const filePath = configPath(cwd);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeTarget(entry))
      .filter((entry): entry is ExecutionTarget => entry !== null);
  } catch {
    return [];
  }
}

export function formatExecutionResult(result: ExecutionResult): string {
  const state = result.exitCode === 0 ? theme.ok('success') : theme.err('failed');
  const summary = `${theme.badge(result.targetId)} ${state} ${theme.dim(`${result.durationMs}ms`)}`;
  const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  return details ? `${summary}\n${details}` : summary;
}
