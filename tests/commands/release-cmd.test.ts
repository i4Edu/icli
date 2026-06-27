import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';

const {
  simpleGitMock,
  checkIsRepoMock,
  tagsMock,
  logMock,
  statusMock,
  addMock,
  commitMock,
  addTagMock,
} = vi.hoisted(() => ({
  simpleGitMock: vi.fn(),
  checkIsRepoMock: vi.fn(),
  tagsMock: vi.fn(),
  logMock: vi.fn(),
  statusMock: vi.fn(),
  addMock: vi.fn(),
  commitMock: vi.fn(),
  addTagMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import {
  calculateNextVersion,
  performRelease,
  releaseCommand,
} from '../../src/commands/release-cmd.js';

const spawnSyncMock = vi.mocked(spawnSync);

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  originalCwd = config.cwd;
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-release-cmd-'));
  config.cwd = tmpDir;

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'icopilot', version: '1.3.0' }, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n', 'utf8');

  checkIsRepoMock.mockResolvedValue(true);
  tagsMock.mockResolvedValue({ latest: 'v1.2.0' });
  logMock.mockResolvedValue({
    all: [
      {
        hash: 'abc1234567',
        message: 'feat(cli): add release command',
        author_name: 'Ada',
        date: '2026-06-27',
      },
      {
        hash: 'def7654321',
        message: 'fix: handle dirty trees',
        author_name: 'Linus',
        date: '2026-06-26',
      },
    ],
  });
  statusMock.mockResolvedValue({ isClean: () => true });
  addMock.mockResolvedValue(undefined);
  commitMock.mockResolvedValue({ commit: 'abc1234' });
  addTagMock.mockResolvedValue(undefined);
  simpleGitMock.mockReturnValue({
    checkIsRepo: checkIsRepoMock,
    tags: tagsMock,
    log: logMock,
    status: statusMock,
    add: addMock,
    commit: commitMock,
    addTag: addTagMock,
  });
  spawnSyncMock.mockReturnValue({
    status: 0,
    stdout: '',
    stderr: '',
  } as ReturnType<typeof spawnSync>);
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('release-cmd', () => {
  it('calculates semver bumps including prereleases', () => {
    expect(calculateNextVersion('1.3.0', 'patch')).toBe('1.3.1');
    expect(calculateNextVersion('1.3.0', 'minor')).toBe('1.4.0');
    expect(calculateNextVersion('1.3.0', 'major')).toBe('2.0.0');
    expect(calculateNextVersion('1.3.0', 'prepatch')).toBe('1.3.1-0');
    expect(calculateNextVersion('1.3.1-0', 'prepatch')).toBe('1.3.2-0');
    expect(calculateNextVersion('1.3.0', 'preminor')).toBe('1.4.0-0');
    expect(calculateNextVersion('1.3.0', 'premajor')).toBe('2.0.0-0');
  });

  it('returns a dry-run preview without mutating files or running git/npm writes', async () => {
    statusMock.mockResolvedValue({ isClean: () => false });

    const result = await performRelease({ type: 'patch', dryRun: true });

    expect(result).toEqual({
      version: '1.3.1',
      changelog: expect.stringContaining('### Features'),
      tag: 'v1.3.1',
      published: false,
    });
    expect(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8')).toContain('"version": "1.3.0"');
    expect(addMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
    expect(addTagMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('creates the release commit, changelog, tag, and npm publish command', async () => {
    const result = await performRelease({ type: 'minor', tag: 'next' });

    expect(result.version).toBe('1.4.0');
    expect(result.tag).toBe('v1.4.0');
    expect(result.published).toBe(true);
    expect(result.changelog).toContain('### Features');
    expect(result.changelog).toContain('### Fixes');

    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe('1.4.0');

    const changelog = fs.readFileSync(path.join(tmpDir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('## [Unreleased]');
    expect(changelog).toContain('## [1.4.0] - ');
    expect(changelog).toContain('### Features');
    expect(changelog).toContain('### Fixes');

    expect(addMock).toHaveBeenCalledWith(['package.json', 'CHANGELOG.md']);
    expect(commitMock).toHaveBeenCalledWith('chore(release): v1.4.0');
    expect(addTagMock).toHaveBeenCalledWith('v1.4.0');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm',
      ['publish', '--tag', 'next'],
      expect.objectContaining({
        cwd: tmpDir,
        encoding: 'utf8',
      }),
    );
  });

  it('rejects a real release when the working tree is dirty', async () => {
    statusMock.mockResolvedValue({ isClean: () => false });

    await expect(performRelease({ type: 'patch' })).rejects.toThrow('working tree is dirty');
    expect(commitMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('formats status and preview slash output', async () => {
    const status = await releaseCommand(['status'], tmpDir);
    const preview = await releaseCommand(['preview'], tmpDir);

    expect(status).toContain('Release status');
    expect(status).toContain('1.3.0');
    expect(status).toContain('v1.2.0');
    expect(status).toContain('add release command');

    expect(preview).toContain('Release preview');
    expect(preview).toContain('1.3.1');
    expect(preview).toContain('v1.3.1');
    expect(preview).toContain('dry run');
  });
});
