import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkIsRepoMock, logMock, simpleGitMock } = vi.hoisted(() => ({
  checkIsRepoMock: vi.fn(),
  logMock: vi.fn(),
  simpleGitMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

vi.mock('../../src/ui/theme.js', () => ({
  theme: {
    dim: (text: string) => `<dim>${text}</dim>`,
    hl: (text: string) => `<yellow>${text}</yellow>`,
    user: (text: string) => `<cyan>${text}</cyan>`,
    warn: (text: string) => `<warn>${text}</warn>`,
    err: (text: string) => `<err>${text}</err>`,
  },
}));

import { formatLogEntry, gitLogCommand } from '../../src/commands/git-log-cmd.js';

describe('gitLogCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simpleGitMock.mockReturnValue({
      checkIsRepo: checkIsRepoMock,
      log: logMock,
    });
    checkIsRepoMock.mockResolvedValue(true);
    logMock.mockResolvedValue({
      all: [
        {
          hash: 'abcdef1234567890',
          message: 'Add git log command',
          author_name: 'Alice',
          date: '2026-06-27',
          refs: 'HEAD -> main, tag: v0.1.0',
        },
      ],
      total: 1,
      latest: null,
    });
  });

  it('uses the default count when no args are provided', async () => {
    await gitLogCommand([], 'E:\\AI\\icli');

    expect(simpleGitMock).toHaveBeenCalledWith({ baseDir: 'E:\\AI\\icli' });
    expect(logMock).toHaveBeenCalledWith(['--max-count=15']);
  });

  it('parses -n and clamps the count to 100', async () => {
    await gitLogCommand(['-n', '120'], 'E:\\AI\\icli');

    expect(logMock).toHaveBeenCalledWith(['--max-count=100']);
  });

  it('parses author, since, and branch filters', async () => {
    await gitLogCommand(['--author', 'Alice', '--since', '2024-01-01', 'main'], 'E:\\AI\\icli');

    expect(logMock).toHaveBeenCalledWith([
      '--max-count=15',
      '--author=Alice',
      '--since=2024-01-01',
      'main',
    ]);
  });

  it('formats log output from the git response', async () => {
    const output = await gitLogCommand([], 'E:\\AI\\icli');

    expect(output).toContain('<dim>abcdef1</dim>');
    expect(output).toContain('Add git log command');
    expect(output).toContain('<cyan>Alice</cyan>');
    expect(output).toContain('<yellow>(HEAD -> main, tag: v0.1.0)</yellow>');
  });

  it('formats a single log entry', () => {
    const output = formatLogEntry({
      hash: 'abcdef1234567890',
      shortHash: 'abcdef1',
      subject: 'Add git log command',
      author: 'Alice',
      date: '2026-06-27',
      refs: ['HEAD -> main', 'tag: v0.1.0'],
    });

    expect(output).toBe(
      '<dim>abcdef1</dim> Add git log command <cyan>Alice</cyan> <dim>2026-06-27</dim> <yellow>(HEAD -> main, tag: v0.1.0)</yellow>',
    );
  });

  it('handles non-git repositories gracefully', async () => {
    checkIsRepoMock.mockResolvedValue(false);

    await expect(gitLogCommand([], 'E:\\AI\\not-a-repo')).resolves.toContain(
      'Not a git repository',
    );
    expect(logMock).not.toHaveBeenCalled();
  });

  it('handles not-a-git-repo errors from git log gracefully', async () => {
    logMock.mockRejectedValue(new Error('fatal: not a git repository'));

    await expect(gitLogCommand([], 'E:\\AI\\broken')).resolves.toContain('Not a git repository');
  });
});
