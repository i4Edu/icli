import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkIsRepoMock, tagsMock, logMock, simpleGitMock } = vi.hoisted(() => ({
  checkIsRepoMock: vi.fn(),
  tagsMock: vi.fn(),
  logMock: vi.fn(),
  simpleGitMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

import { buildChangelogPrompt } from '../../src/commands/changelog-cmd.js';

describe('buildChangelogPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkIsRepoMock.mockResolvedValue(true);
    tagsMock.mockResolvedValue({ latest: 'v1.2.3' });
    logMock.mockResolvedValue({
      all: [
        {
          hash: 'abc1234',
          message: 'feat: add changelog command',
          author_name: 'Ada',
          date: '2026-06-27',
        },
        {
          hash: 'def5678',
          message: 'fix: handle invalid ranges',
          author_name: 'Linus',
          date: '2026-06-26',
        },
      ],
    });
    simpleGitMock.mockReturnValue({
      checkIsRepo: checkIsRepoMock,
      tags: tagsMock,
      log: logMock,
    });
  });

  it('uses the last tag by default', async () => {
    const payload = await buildChangelogPrompt([], 'E:\\AI\\icli');

    expect(tagsMock).toHaveBeenCalledOnce();
    expect(logMock).toHaveBeenCalledWith(['v1.2.3..HEAD']);
    expect(payload.fromRef).toBe('v1.2.3');
    expect(payload.toRef).toBe('HEAD');
    expect(payload.commits).toEqual([
      {
        hash: 'abc1234',
        subject: 'feat: add changelog command',
        author: 'Ada',
        date: '2026-06-27',
      },
      {
        hash: 'def5678',
        subject: 'fix: handle invalid ranges',
        author: 'Linus',
        date: '2026-06-26',
      },
    ]);
  });

  it('uses the provided ref range', async () => {
    const payload = await buildChangelogPrompt(['v1.0.0..HEAD'], 'E:\\AI\\icli');

    expect(logMock).toHaveBeenCalledWith(['v1.0.0..HEAD']);
    expect(payload.fromRef).toBe('v1.0.0');
    expect(payload.toRef).toBe('HEAD');
  });

  it('uses the requested last commit count', async () => {
    const payload = await buildChangelogPrompt(['--last', '5'], 'E:\\AI\\icli');

    expect(logMock).toHaveBeenCalledWith({ maxCount: 5 });
    expect(payload.fromRef).toBe('def5678');
    expect(payload.toRef).toBe('HEAD');
  });

  it('falls back to the last 20 commits when no tag exists', async () => {
    tagsMock.mockResolvedValue({ latest: undefined });

    const payload = await buildChangelogPrompt([], 'E:\\AI\\icli');

    expect(logMock).toHaveBeenCalledWith({ maxCount: 20 });
    expect(payload.fromRef).toBe('def5678');
    expect(payload.toRef).toBe('HEAD');
  });

  it('includes commit subjects in the generated prompt', async () => {
    const payload = await buildChangelogPrompt([], 'E:\\AI\\icli');

    expect(payload.prompt).toContain('feat: add changelog command');
    expect(payload.prompt).toContain('fix: handle invalid ranges');
    expect(payload.prompt).toContain('Breaking Changes');
    expect(payload.prompt).toContain('Features');
    expect(payload.prompt).toContain('Documentation');
  });

  it('handles non-git directories gracefully', async () => {
    checkIsRepoMock.mockResolvedValue(false);

    const payload = await buildChangelogPrompt([], 'E:\\AI\\not-a-repo');

    expect(payload).toEqual({
      commits: [],
      fromRef: '',
      toRef: '',
      prompt: 'Cannot generate a changelog because "E:\\AI\\not-a-repo" is not a git repository.',
    });
    expect(logMock).not.toHaveBeenCalled();
  });
});
