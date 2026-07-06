import { describe, expect, it } from 'vitest';
import {
  ExecutionFabric,
  formatEnvironmentList,
  formatExecutionOutcome,
} from '../../src/delivery/execution-fabric.js';

describe('ExecutionFabric', () => {
  it('selects the best matching environment and records outcomes', () => {
    const fabric = new ExecutionFabric();
    fabric.registerEnvironment({
      id: 'local-1',
      name: 'Developer laptop',
      type: 'local',
      capabilities: ['node', 'git'],
      status: 'ready',
    });
    fabric.registerEnvironment({
      id: 'cloud-1',
      name: 'Cloud runner',
      type: 'cloud',
      capabilities: ['node', 'git', 'docker', 'k8s'],
      status: 'ready',
    });

    const selected = fabric.selectEnvironment(['node', 'git']);
    expect(selected?.id).toBe('local-1');

    const outcome = fabric.submit({
      id: 'req-1',
      command: 'npm test',
      requirements: ['node', 'git'],
      timeout: 300,
      priority: 2,
    });

    expect(outcome.exitCode).toBe(0);
    expect(fabric.getOutcome('req-1')?.environmentId).toBe('local-1');
    expect(formatExecutionOutcome(outcome)).toContain('req-1');
  });

  it('handles unavailable environments and capacity reporting', () => {
    const fabric = new ExecutionFabric();
    fabric.registerEnvironment({
      id: 'container-1',
      name: 'Container worker',
      type: 'container',
      capabilities: ['docker'],
      status: 'offline',
    });

    const outcome = fabric.submit({
      id: 'req-2',
      command: 'docker build fail',
      requirements: ['docker'],
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.environmentId).toBe('unassigned');
    expect(fabric.getCapacity()).toEqual({ total: 1, ready: 0, busy: 0, offline: 1 });
    expect(formatEnvironmentList(fabric.listEnvironments())).toContain('Container worker');
    expect(fabric.deregister('container-1')).toBe(true);
  });
});
