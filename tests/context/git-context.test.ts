import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { config } from '../../src/config.js';
import { GitContextProvider } from '../../src/context/git-context.js';
import { buildSystemPrompt } from '../../src/modes/turn.js';
import { Session } from '../../src/session/session.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const execSyncMock = vi.mocked(execSync);

let tempRoot: string;
const originalSessionDir = config.sessionDir;

beforeEach(() => {
  tempRoot = path.join(
    process.cwd(),
    '.test-temp',
    'git-context',
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(tempRoot, { recursive: true });
  config.sessionDir = tempRoot;
  execSyncMock.mockReset();
});

afterEach(() => {
  config.sessionDir = originalSessionDir;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GitContextProvider', () => {
  it('returns recently modified files from recent commits', async () => {
    execSyncMock.mockImplementation((command) => {
      const text = String(command);
      if (text.includes('rev-parse --is-inside-work-tree')) return 'true\n';
      if (text.includes('log --name-status')) {
        return ['M\tsrc/app.ts', 'A\tREADME.md', 'D\tlegacy.ts', 'M\tsrc/app.ts'].join('\n');
      }
      throw new Error(`Unexpected git command: ${text}`);
    });

    const provider = new GitContextProvider(tempRoot);
    const files = await provider.getRecentlyModified({
      commits: 3,
      since: '2 weeks ago',
      author: 'Alice',
      paths: ['src', 'README.md'],
    });

    expect(files).toEqual([
      { path: 'src/app.ts', status: 'modified' },
      { path: 'README.md', status: 'added' },
      { path: 'legacy.ts', status: 'deleted' },
    ]);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('--since="2 weeks ago"'),
      expect.objectContaining({ cwd: tempRoot, encoding: 'utf8' }),
    );
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('--author="Alice"'),
      expect.objectContaining({ cwd: tempRoot, encoding: 'utf8' }),
    );
  });

  it('returns staged, unstaged, and branch diff files with patches', async () => {
    execSyncMock.mockImplementation((command) => {
      const text = String(command);
      if (text.includes('rev-parse --is-inside-work-tree')) return 'true\n';
      if (text.includes('diff --cached --name-status')) return 'M\tsrc/staged.ts\nA\tsrc/new.ts\n';
      if (text.includes('diff --cached -- "src/staged.ts"')) return '@@ -1 +1 @@\n-old\n+new\n';
      if (text.includes('diff --cached -- "src/new.ts"')) return 'diff --git a/src/new.ts b/src/new.ts\n';
      if (text.includes('status --porcelain=v1')) {
        return [' M src/dirty.ts', ' D src/deleted.ts', '?? src/untracked.ts', 'M  src/staged-only.ts'].join(
          '\n',
        );
      }
      if (text.includes('diff  -- "src/dirty.ts"')) return '@@ -1 +1 @@\n-before\n+after\n';
      if (text.includes('diff  -- "src/deleted.ts"')) return 'diff --git a/src/deleted.ts b/src/deleted.ts\n';
      if (text.includes('diff --name-status "origin/main...HEAD"')) {
        return 'M\tsrc/feature.ts\nD\tsrc/old.ts\n';
      }
      if (text.includes('diff "origin/main...HEAD" -- "src/feature.ts"')) {
        return '@@ -1 +1 @@\n-main\n+feature\n';
      }
      if (text.includes('diff "origin/main...HEAD" -- "src/old.ts"')) {
        return 'diff --git a/src/old.ts b/src/old.ts\n';
      }
      throw new Error(`Unexpected git command: ${text}`);
    });

    const provider = new GitContextProvider(tempRoot);

    await expect(provider.getStagedFiles()).resolves.toEqual([
      { path: 'src/staged.ts', status: 'modified', diff: '@@ -1 +1 @@\n-old\n+new' },
      {
        path: 'src/new.ts',
        status: 'added',
        diff: 'diff --git a/src/new.ts b/src/new.ts',
      },
    ]);
    await expect(provider.getUnstagedFiles()).resolves.toEqual([
      { path: 'src/dirty.ts', status: 'modified', diff: '@@ -1 +1 @@\n-before\n+after' },
      {
        path: 'src/deleted.ts',
        status: 'deleted',
        diff: 'diff --git a/src/deleted.ts b/src/deleted.ts',
      },
      { path: 'src/untracked.ts', status: 'added', diff: undefined },
    ]);
    await expect(provider.getBranchDiff('origin/main')).resolves.toEqual([
      { path: 'src/feature.ts', status: 'modified', diff: '@@ -1 +1 @@\n-main\n+feature' },
      {
        path: 'src/old.ts',
        status: 'deleted',
        diff: 'diff --git a/src/old.ts b/src/old.ts',
      },
    ]);
  });

  it('returns blame metadata for a file and line', async () => {
    execSyncMock.mockImplementation((command) => {
      const text = String(command);
      if (text.includes('rev-parse --is-inside-work-tree')) return 'true\n';
      if (text.includes('blame -L 42,42 --porcelain -- "src/app.ts"')) {
        return [
          'abc123 42 42 1',
          'author Jane Doe',
          'author-mail <jane@example.com>',
          'author-time 1710000000',
          'summary Refine git context loading',
          '\tconst value = 42;',
        ].join('\n');
      }
      throw new Error(`Unexpected git command: ${text}`);
    });

    const provider = new GitContextProvider(tempRoot);
    const blame = await provider.getBlameContext('src/app.ts', 42);

    expect(blame).toEqual({
      author: 'Jane Doe',
      date: new Date(1710000000 * 1000).toISOString(),
      commit: 'abc123',
      message: 'Refine git context loading',
    });
  });

  it('initializes session git context so the system prompt includes it', async () => {
    execSyncMock.mockImplementation((command) => {
      const text = String(command);
      if (text.includes('rev-parse --is-inside-work-tree')) return 'true\n';
      if (text.includes('diff --cached --name-status')) return '';
      if (text.includes('status --porcelain=v1')) return ' M src/live.ts\n';
      if (text.includes('diff  -- "src/live.ts"')) return '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n';
      if (text.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main\n';
      if (text.includes('diff --name-status "main...HEAD"')) return '';
      throw new Error(`Unexpected git command: ${text}`);
    });
    config.sessionDir = tempRoot;

    const session = new Session({ id: 'git-session', cwd: tempRoot });
    await session.initializeGitContext();

    expect(session.state.gitContext).toEqual([
      {
        path: 'src/live.ts',
        status: 'modified',
        diff: '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;',
      },
    ]);
    expect(buildSystemPrompt(session)).toContain('### Git context');
    expect(buildSystemPrompt(session)).toContain('src/live.ts');
  }, 20_000);
});
