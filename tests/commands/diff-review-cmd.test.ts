import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkIsRepoMock, diffMock, simpleGitMock } = vi.hoisted(() => {
  const checkIsRepo = vi.fn();
  const diff = vi.fn();
  const simpleGit = vi.fn(() => ({
    checkIsRepo,
    diff,
  }));
  return {
    checkIsRepoMock: checkIsRepo,
    diffMock: diff,
    simpleGitMock: simpleGit,
  };
});

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

import { buildDiffReviewPrompt } from '../../src/commands/diff-review-cmd.js';

describe('buildDiffReviewPrompt', () => {
  beforeEach(() => {
    simpleGitMock.mockClear();
    checkIsRepoMock.mockReset();
    diffMock.mockReset();
    checkIsRepoMock.mockResolvedValue(true);
    diffMock.mockResolvedValue('diff --git a/file.ts b/file.ts');
  });

  it('uses git diff for unstaged changes when no args are provided', async () => {
    const payload = await buildDiffReviewPrompt([], process.cwd());

    expect(simpleGitMock).toHaveBeenCalledWith({ baseDir: process.cwd() });
    expect(diffMock).toHaveBeenCalledWith([]);
    expect(payload.scope).toBe('unstaged changes');
    expect(payload.diff).toContain('diff --git');
    expect(payload.prompt).toContain('bugs and logic errors');
  });

  it('uses cached diff for staged reviews', async () => {
    const payload = await buildDiffReviewPrompt(['--staged'], process.cwd());

    expect(diffMock).toHaveBeenCalledWith(['--cached']);
    expect(payload.scope).toBe('staged changes');
  });

  it('compares the current branch against a named branch', async () => {
    const payload = await buildDiffReviewPrompt(['main'], process.cwd());

    expect(diffMock).toHaveBeenCalledWith(['main...HEAD']);
    expect(payload.scope).toBe('changes from main to HEAD');
  });

  it('diffs a commit range directly', async () => {
    const payload = await buildDiffReviewPrompt(['abc123..def456'], process.cwd());

    expect(diffMock).toHaveBeenCalledWith(['abc123..def456']);
    expect(payload.scope).toBe('changes between abc123..def456');
  });

  it('diffs a specific file when the target looks like a path', async () => {
    const payload = await buildDiffReviewPrompt(['package.json'], process.cwd());

    expect(diffMock).toHaveBeenCalledWith(['--', 'package.json']);
    expect(payload.scope).toContain('package.json');
  });

  it('throws a helpful error outside a git repository', async () => {
    checkIsRepoMock.mockResolvedValue(false);

    await expect(buildDiffReviewPrompt([], process.cwd())).rejects.toThrow(
      `Not a git repository: ${process.cwd()}`,
    );
    expect(diffMock).not.toHaveBeenCalled();
  });
});
