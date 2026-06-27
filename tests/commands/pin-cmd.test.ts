import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashContext } from '../../src/commands/slash.js';
import type { PinnedFile } from '../../src/context/pinned.js';

vi.mock('../../src/commands/git.js', () => ({
  showDiff: vi.fn(),
  commitFromStaged: vi.fn(),
  prDescription: vi.fn(),
}));

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: vi.fn(),
}));

vi.mock('../../src/session/manager.js', () => ({
  pickSession: vi.fn(),
  exportSession: vi.fn(),
}));

vi.mock('../../src/commands/git-extra.js', () => ({
  reviewStaged: vi.fn(),
  draftIssue: vi.fn(),
  scaffoldBranch: vi.fn(),
}));

vi.mock('../../src/commands/index-cmd.js', () => ({
  indexCommand: vi.fn(),
}));

vi.mock('../../src/commands/diff-review-cmd.js', () => ({
  reviewDiff: vi.fn(),
}));

vi.mock('../../src/commands/route-cmd.js', () => ({
  routeCommand: vi.fn(() => 'routing profile: fixed\n'),
}));

vi.mock('../../src/commands/agent-cmd.js', () => ({
  agentCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/commands/explore-cmd.js', () => ({
  exploreCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/commands/skill-cmd.js', () => ({
  skillCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/modes/background.js', () => ({
  backgroundTaskManager: {
    formatTaskList: vi.fn(() => ''),
    formatTaskResult: vi.fn(() => ''),
  },
}));

vi.mock('../../src/commands/task-cmd.js', () => ({
  taskCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/commands/memory-cmd.js', () => ({
  memoryCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/session/share.js', () => ({
  shareCommand: vi.fn(async () => ''),
}));

vi.mock('../../src/extensions/loader.js', () => ({
  extensionCommand: vi.fn(async () => ''),
}));

vi.mock('simple-git', () => ({
  default: () => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    log: vi.fn().mockResolvedValue({ all: [] }),
    tags: vi.fn().mockResolvedValue({ latest: null }),
  }),
}));

let tmpDir: string;
let output = '';
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let handleSlash: typeof import('../../src/commands/slash.js').handleSlash;

beforeAll(async () => {
  ({ handleSlash } = await import('../../src/commands/slash.js'));
}, 120_000);

function createContext(): SlashContext {
  const session = {
    state: {
      model: 'gpt-test',
      mode: 'ask' as const,
      cwd: tmpDir,
      messages: [],
      todos: [],
      pinned: [] as PinnedFile[],
    },
    reset: vi.fn(),
    setModel: vi.fn(),
    setCwd: vi.fn(),
    setMode: vi.fn(),
    setTodos: vi.fn(),
    tokenUsage: vi.fn(() => 0),
    compactInto: vi.fn(),
    setPinned: vi.fn((files: PinnedFile[]) => {
      session.state.pinned = files;
    }),
  };

  return {
    session: session as unknown as SlashContext['session'],
    abort: new AbortController(),
    exit: vi.fn(),
  };
}

beforeEach(() => {
  const baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'pin-cmd-'));
  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('pin slash commands', { timeout: 30_000 }, () => {
  it('pins a file and lists pinned files with token counts', async () => {
    const ctx = createContext();
    const filePath = path.join(tmpDir, 'notes.ts');
    fs.writeFileSync(filePath, 'export const pinned = true;\n');

    await handleSlash('/pin notes.ts', ctx);

    expect(ctx.session.setPinned).toHaveBeenCalledTimes(1);
    expect(ctx.session.state.pinned).toHaveLength(1);
    expect(ctx.session.state.pinned[0]).toMatchObject({
      path: filePath,
      tokens: expect.any(Number),
    });
    expect(output).toContain('pinned');
    expect(output).toContain('tokens');

    output = '';
    await handleSlash('/pin', ctx);

    expect(output).toContain('Pinned files');
    expect(output).toContain(filePath);
    expect(output).toContain('tokens');
  });

  it('unpinns a specific file', async () => {
    const ctx = createContext();
    const filePath = path.join(tmpDir, 'one.ts');
    fs.writeFileSync(filePath, 'export const one = 1;\n');

    await handleSlash('/pin one.ts', ctx);
    expect(ctx.session.state.pinned).toHaveLength(1);

    output = '';
    await handleSlash('/unpin one.ts', ctx);

    expect(ctx.session.setPinned).toHaveBeenLastCalledWith([]);
    expect(ctx.session.state.pinned).toEqual([]);
    expect(output).toContain(`unpinned ${filePath}`);
  });

  it('clears all pinned files with /unpin --all', async () => {
    const ctx = createContext();
    fs.writeFileSync(path.join(tmpDir, 'one.ts'), 'export const one = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'two.ts'), 'export const two = 2;\n');

    await handleSlash('/pin one.ts', ctx);
    await handleSlash('/pin two.ts', ctx);
    expect(ctx.session.state.pinned).toHaveLength(2);

    output = '';
    await handleSlash('/unpin --all', ctx);

    expect(ctx.session.setPinned).toHaveBeenLastCalledWith([]);
    expect(ctx.session.state.pinned).toEqual([]);
    expect(output).toContain('cleared 2 pinned files');
  });
});
