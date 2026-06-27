import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashContext } from '../../src/commands/slash.js';
import { config } from '../../src/config.js';

const compactSessionMock = vi.fn();
const runAutopilotMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/commands/git.js', () => ({
  showDiff: vi.fn(),
  commitFromStaged: vi.fn(),
  prDescription: vi.fn(),
}));

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: compactSessionMock,
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

vi.mock('simple-git', () => ({
  default: () => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    log: vi.fn().mockResolvedValue({ all: [] }),
    tags: vi.fn().mockResolvedValue({ latest: null }),
  }),
}));

vi.mock('../../src/commands/route-cmd.js', () => ({
  routeCommand: vi.fn(() => 'routing profile: fixed\n'),
}));

vi.mock('../../src/modes/autopilot.js', () => ({
  runAutopilot: runAutopilotMock,
}));

let tmpDir: string;
let originalCwd: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let output: string;

function createContext(mode: 'ask' | 'plan' = 'ask'): SlashContext {
  const session = {
    state: {
      model: 'gpt-test',
      mode,
      cwd: tmpDir,
      messages: [{ role: 'user', content: 'hello' }],
      autopilotEnabled: false,
    },
    reset: vi.fn(),
    setModel: vi.fn((model: string) => {
      session.state.model = model;
    }),
    setCwd: vi.fn((cwd: string) => {
      session.state.cwd = cwd;
    }),
    setMode: vi.fn((nextMode: 'ask' | 'plan') => {
      session.state.mode = nextMode;
    }),
    setAutopilotEnabled: vi.fn((enabled: boolean) => {
      session.state.autopilotEnabled = enabled;
    }),
    tokenUsage: vi.fn(() => 42),
    compactInto: vi.fn(),
  };

  return {
    session: session as unknown as SlashContext['session'],
    abort: new AbortController(),
    exit: vi.fn(),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-slash-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  compactSessionMock.mockResolvedValue('compacted summary');
});

afterEach(() => {
  stdoutSpy.mockRestore();
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('handleSlash', { timeout: 180_000 }, () => {
  it('ignores non-slash input', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    await expect(handleSlash('hello', createContext())).resolves.toEqual({
      handled: false,
      consumed: false,
    });
  });

  it('recognizes /help', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const result = await handleSlash('/help', createContext());

    expect(result).toEqual({ handled: true, consumed: true });
    expect(output).toContain('Slash commands');
  });

  it('recognizes /clear', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/clear', ctx);

    expect(ctx.session.reset).toHaveBeenCalled();
    expect(output).toContain('history cleared');
  });

  it('recognizes /model with and without an argument', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/model', ctx);
    expect(output).toContain('current model: gpt-test');

    await handleSlash('/model gpt-4o', ctx);
    expect(ctx.session.setModel).toHaveBeenCalledWith('gpt-4o');
    expect(output).toContain('model');
  });

  it('recognizes /cwd with and without an argument', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    const nextDir = path.join(tmpDir, 'next');
    fs.mkdirSync(nextDir);

    await handleSlash('/cwd', ctx);
    expect(output).toContain(`cwd: ${tmpDir}`);

    await handleSlash('/cwd next', ctx);
    expect(config.cwd).toBe(nextDir);
    expect(ctx.session.setCwd).toHaveBeenCalledWith(nextDir);
  });

  it('recognizes /context', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/context', ctx);

    expect(output).toContain('Context hub');
    expect(output).toContain('Conversation history');
    expect(output).toContain('Tool results');
  });

  it('recognizes /plan', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/plan', ctx);

    expect(ctx.session.setMode).toHaveBeenCalledWith('plan');
    expect(output).toContain('mode');
  });

  it('toggles /autopilot with no goal', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/autopilot', ctx);

    expect(ctx.session.setAutopilotEnabled).toHaveBeenCalledWith(true);
    expect(output).toContain('autopilot');
  });

  it('runs /autopilot <goal>', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/autopilot wire the CLI', ctx);

    expect(runAutopilotMock).toHaveBeenCalledWith('wire the CLI', {
      session: ctx.session,
      signal: ctx.abort.signal,
    });
  });

  it('recognizes /tasks', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/tasks', createContext());

    expect(output).toContain('Background tasks');
  });

  it('reports unknown slash commands as consumed', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const result = await handleSlash('/wat', createContext());

    expect(result).toEqual({ handled: true, consumed: true });
    expect(output).toContain('unknown command: /wat');
  });
});
