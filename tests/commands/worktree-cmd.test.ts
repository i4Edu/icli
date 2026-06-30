import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  };
});

describe('worktreeCommand', () => {
  let worktreeCommand: typeof import('../../src/commands/worktree-cmd.js').worktreeCommand;

  beforeAll(async () => {
    ({ worktreeCommand } = await import('../../src/commands/worktree-cmd.js'));
  });

  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('lists worktrees', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'true', stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: [
          'worktree /repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /repo/.worktrees/feat',
          'HEAD 2222222',
          'branch refs/heads/feat',
          '',
        ].join('\n'),
        stderr: '',
      });

    const output = worktreeCommand(['list'], '/repo');
    expect(output).toContain('Git worktrees');
    expect(output).toContain('/repo/.worktrees/feat');
    expect(output).toContain('feat');
  });

  it('adds worktree and creates branch when missing', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'true', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const output = worktreeCommand(['add', 'feature/new-api'], '/repo');
    expect(output).toContain('worktree added');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '-b', 'feature/new-api', expect.stringContaining('.worktrees')],
      expect.any(Object),
    );
  });

  it('removes a worktree with --force', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'true', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const output = worktreeCommand(['remove', '.worktrees/feat', '--force'], '/repo');
    expect(output).toContain('worktree removed');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', expect.stringContaining('.worktrees')],
      expect.any(Object),
    );
  });
});
