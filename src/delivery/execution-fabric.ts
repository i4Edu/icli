import { randomUUID } from 'node:crypto';
import { theme } from '../ui/theme.js';

export type ExecutionEnvironmentType = 'local' | 'container' | 'cloud' | 'hybrid';
export type ExecutionEnvironmentStatus = 'ready' | 'busy' | 'offline';

export interface ExecutionEnvironment {
  id: string;
  name: string;
  type: ExecutionEnvironmentType;
  capabilities: string[];
  status: ExecutionEnvironmentStatus;
}

export interface ExecutionRequest {
  id: string;
  command: string;
  environment?: string;
  requirements: string[];
  timeout?: number;
  priority?: number;
}

export interface ExecutionOutcome {
  requestId: string;
  environmentId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  resources?: Record<string, number | string>;
}

export class ExecutionFabric {
  private readonly environments = new Map<string, ExecutionEnvironment>();
  private readonly outcomes = new Map<string, ExecutionOutcome>();

  registerEnvironment(env: ExecutionEnvironment): ExecutionEnvironment {
    this.environments.set(env.id, structuredClone(env));
    return structuredClone(env);
  }

  deregister(id: string): boolean {
    return this.environments.delete(id);
  }

  submit(request: ExecutionRequest): ExecutionOutcome {
    const normalizedRequest = {
      ...request,
      id: request.id || randomUUID(),
    };
    const environment = normalizedRequest.environment
      ? this.environments.get(normalizedRequest.environment)
      : this.selectEnvironment(normalizedRequest.requirements);

    if (!environment) {
      const missing: ExecutionOutcome = {
        requestId: normalizedRequest.id,
        environmentId: 'unassigned',
        exitCode: 1,
        stdout: '',
        stderr: 'No execution environment satisfies the request.',
        durationMs: 0,
      };
      this.outcomes.set(normalizedRequest.id, structuredClone(missing));
      return structuredClone(missing);
    }

    environment.status = 'busy';
    const exitCode = /fail/i.test(normalizedRequest.command) ? 1 : 0;
    const outcome: ExecutionOutcome = {
      requestId: normalizedRequest.id,
      environmentId: environment.id,
      exitCode,
      stdout: exitCode === 0 ? `Executed: ${normalizedRequest.command}` : '',
      stderr: exitCode === 0 ? '' : `Execution failed: ${normalizedRequest.command}`,
      durationMs: estimateDuration(normalizedRequest),
      resources: {
        timeout: normalizedRequest.timeout ?? 0,
        priority: normalizedRequest.priority ?? 0,
      },
    };

    environment.status = 'ready';
    this.environments.set(environment.id, structuredClone(environment));
    this.outcomes.set(normalizedRequest.id, structuredClone(outcome));
    return structuredClone(outcome);
  }

  getOutcome(requestId: string): ExecutionOutcome | undefined {
    const outcome = this.outcomes.get(requestId);
    return outcome ? structuredClone(outcome) : undefined;
  }

  selectEnvironment(requirements: string[]): ExecutionEnvironment | undefined {
    const candidates = [...this.environments.values()]
      .filter((environment) => environment.status === 'ready')
      .filter((environment) =>
        requirements.every((requirement) => environment.capabilities.includes(requirement)),
      )
      .sort((left, right) => left.capabilities.length - right.capabilities.length);
    return candidates[0] ? structuredClone(candidates[0]) : undefined;
  }

  listEnvironments(): ExecutionEnvironment[] {
    return [...this.environments.values()].map((environment) => structuredClone(environment));
  }

  getCapacity(): { total: number; ready: number; busy: number; offline: number } {
    const summary = { total: this.environments.size, ready: 0, busy: 0, offline: 0 };
    for (const environment of this.environments.values()) {
      summary[environment.status] += 1;
    }
    return summary;
  }
}

export function formatExecutionOutcome(outcome: ExecutionOutcome): string {
  const status = outcome.exitCode === 0 ? theme.ok('success') : theme.err('failure');
  return `${theme.badge('exec')} ${status} ${theme.hl(outcome.requestId)} on ${outcome.environmentId}`;
}

export function formatEnvironmentList(envs: ExecutionEnvironment[]): string {
  if (!envs.length) {
    return `${theme.badge('fabric')} ${theme.dim('No environments registered.')}`;
  }

  const lines = envs.map(
    (env) => `${theme.hl(env.name)} (${env.type}) ${colorEnvironmentStatus(env.status)}`,
  );
  return `${theme.badge('fabric')}\n${lines.join('\n')}`;
}

function estimateDuration(request: ExecutionRequest): number {
  return Math.max(100, Math.min(request.timeout ?? 500, 5_000));
}

function colorEnvironmentStatus(status: ExecutionEnvironmentStatus): string {
  switch (status) {
    case 'ready':
      return theme.ok(status);
    case 'busy':
      return theme.brand(status);
    case 'offline':
      return theme.err(status);
  }
}
