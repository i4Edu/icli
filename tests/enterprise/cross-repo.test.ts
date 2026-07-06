import { describe, expect, it } from 'vitest';
import {
  CrossRepoCoordinator,
  formatCoordinationStatus,
} from '../../src/enterprise/cross-repo.js';

describe('CrossRepoCoordinator', () => {
  it('plans, executes, lists active work, and resolves conflicts', () => {
    const coordinator = new CrossRepoCoordinator({
      now: () => new Date('2026-03-01T00:00:00.000Z'),
    });

    const coordination = coordinator.plan(
      ['repo-a', 'repo-b'],
      [
        {
          repo: 'repo-a',
          branch: 'feature/a',
          commits: ['a1'],
        },
        {
          repo: 'repo-b',
          branch: 'feature/b',
          commits: ['b1'],
          status: 'conflict',
        },
      ],
      'parallel',
    );

    expect(coordinator.listActive().map((entry) => entry.id)).toContain(coordination.id);

    const conflicted = coordinator.execute(coordination.id);
    expect(conflicted.status).toBe('conflict');

    const resolved = coordinator.resolveConflict(coordination.id, 'repo-b', 'manual-merge');
    expect(resolved.changes.find((change) => change.repo === 'repo-b')?.status).toBe('applied');
    expect(resolved.changes.find((change) => change.repo === 'repo-b')?.commits).toContain(
      'resolution:manual-merge',
    );

    const complete = coordinator.execute(coordination.id);
    expect(complete.status).toBe('complete');
    expect(formatCoordinationStatus(complete)).toContain('repo-a');
    expect(coordinator.listActive()).toEqual([]);
  });

  it('rolls back on execution failure when requested', () => {
    const coordinator = new CrossRepoCoordinator();
    const coordination = coordinator.plan(
      ['repo-a'],
      [
        {
          repo: 'repo-a',
          branch: 'feature/a',
          commits: ['a1'],
          status: 'conflict',
        },
      ],
    );

    const failed = coordinator.execute(coordination.id, { rollbackOnFailure: true });
    expect(failed.status).toBe('failed');
    expect(failed.changes[0]?.status).toBe('reverted');

    const rolledBack = coordinator.rollback(coordination.id);
    expect(rolledBack.status).toBe('rolled-back');
  });
});
