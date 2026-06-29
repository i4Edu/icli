import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitUndo, registerAiCommit } from '../../src/commands/git-undo-cmd.js';

const { checkIsRepoMock, rawMock, simpleGitMock } = vi.hoisted(() => ({
  checkIsRepoMock: vi.fn(),
  rawMock: vi.fn(),
  simpleGitMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

vi.mock('../../src/config.js', () => ({
  config: {
    cwd: 'E:\\AI\\icli',
  },
}));

describe('gitUndo', { timeout: 180_000 }, () => {
  const tempRoot = path.join(process.cwd(), '.vitest-git-undo-cmd');
  let aiCommitsPath: string;

  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    aiCommitsPath = path.join(
      tempRoot,
      `${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    process.env.ICOPILOT_AI_COMMITS_PATH = aiCommitsPath;
    vi.clearAllMocks();
    simpleGitMock.mockReturnValue({
      checkIsRepo: checkIsRepoMock,
      raw: rawMock,
    });
    checkIsRepoMock.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.ICOPILOT_AI_COMMITS_PATH;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  it('registers AI commits and performs a soft undo for tracked HEAD', async () => {
    registerAiCommit('abc123');
    rawMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'HEAD') return 'abc123\n';
      if (args[0] === 'show' && args[2] === '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B') {
        return 'abc123\x1ffeat: add undo\x1fCopilot\x1fcopilot@github.com\x1ffeat: add undo';
      }
      if (args[0] === 'show' && args[2] === '--name-only') return 'src/commands/git-undo-cmd.ts\n';
      if (args[0] === 'rev-parse' && args[2] === 'HEAD~1') return 'def456\n';
      if (args[0] === 'reset') return '';
      throw new Error(`unexpected raw args: ${args.join(' ')}`);
    });

    const result = await gitUndo({ cwd: 'E:\\AI\\icli' });

    expect(result).toContain('undid AI commit abc123');
    expect(result).toContain('feat: add undo');
    expect(result).toContain('soft reset');
    expect(result).toContain('src/commands/git-undo-cmd.ts');
    expect(rawMock).toHaveBeenCalledWith(['reset', '--soft', 'HEAD~1']);
    expect(JSON.parse(fs.readFileSync(aiCommitsPath, 'utf8'))).toEqual({ commits: [] });
  });

  it('supports hard undo', async () => {
    registerAiCommit('abc123');
    rawMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'HEAD') return 'abc123\n';
      if (args[0] === 'show' && args[2] === '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B') {
        return 'abc123\x1fchore: cleanup\x1fCopilot\x1fcopilot@github.com\x1fchore: cleanup';
      }
      if (args[0] === 'show' && args[2] === '--name-only') return 'src/commands/slash.ts\n';
      if (args[0] === 'rev-parse' && args[2] === 'HEAD~1') return 'def456\n';
      if (args[0] === 'reset') return '';
      throw new Error(`unexpected raw args: ${args.join(' ')}`);
    });

    const result = await gitUndo({ hard: true });

    expect(result).toContain('hard reset');
    expect(rawMock).toHaveBeenCalledWith(['reset', '--hard', 'HEAD~1']);
  });

  it('refuses to undo non-AI commits', async () => {
    rawMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'HEAD') return 'abc123\n';
      if (args[0] === 'show' && args[2] === '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B') {
        return 'abc123\x1ffix: production issue\x1fAlice\x1falice@example.com\x1ffix: production issue';
      }
      if (args[0] === 'show' && args[2] === '--name-only') return 'src/app.ts\n';
      throw new Error(`unexpected raw args: ${args.join(' ')}`);
    });

    const result = await gitUndo();

    expect(result).toContain('Refusing to undo abc123');
    expect(rawMock).not.toHaveBeenCalledWith(['reset', '--soft', 'HEAD~1']);
  });

  it('accepts AI-looking commits even when they are not registered', async () => {
    rawMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'HEAD') return 'abc123\n';
      if (args[0] === 'show' && args[2] === '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B') {
        return 'abc123\x1fdocs: update help\x1fCopilot\x1fcopilot@github.com\x1fdocs: update help';
      }
      if (args[0] === 'show' && args[2] === '--name-only') return 'README.md\n';
      if (args[0] === 'rev-parse' && args[2] === 'HEAD~1') return 'def456\n';
      if (args[0] === 'reset') return '';
      throw new Error(`unexpected raw args: ${args.join(' ')}`);
    });

    const result = await gitUndo();

    expect(result).toContain('undid AI commit abc123');
    expect(rawMock).toHaveBeenCalledWith(['reset', '--soft', 'HEAD~1']);
  });
});
