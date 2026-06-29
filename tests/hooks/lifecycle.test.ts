import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{
    command: string;
    options: Record<string, unknown>;
    stdin: string;
    killed: boolean;
  }>,
  queue: [] as Array<{
    code?: number;
    stdout?: string;
    stderr?: string;
    delay?: number;
    hang?: boolean;
  }>,
}));

const streamChatMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, _args: string[] = [], options: Record<string, unknown> = {}) => {
    const call = { command, options, stdin: '', killed: false };
    spawnState.calls.push(call);
    const child = new EventEmitter() as EventEmitter & {
      stdin: { write: (chunk: string) => boolean; end: () => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdin = {
      write: (chunk: string) => {
        call.stdin += String(chunk);
        return true;
      },
      end: () => undefined,
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      call.killed = true;
    };
    const next = spawnState.queue.shift() ?? { code: 0 };
    if (!next.hang) {
      setTimeout(() => {
        if (next.stdout) child.stdout.emit('data', next.stdout);
        if (next.stderr) child.stderr.emit('data', next.stderr);
        child.emit('close', next.code ?? 0);
      }, next.delay ?? 0);
    }
    return child;
  }),
}));

vi.mock('../../src/api/github-models.js', () => ({
  streamChat: streamChatMock,
}));

import { config } from '../../src/config.js';
import { HookManager, hookManager } from '../../src/hooks/lifecycle.js';
import { Session } from '../../src/session/session.js';
import { runTurn } from '../../src/modes/turn.js';
import { dispatchTool } from '../../src/tools/registry.js';

describe('HookManager', () => {
  let testRoot: string;
  let projectDir: string;
  let homeDir: string;
  let originalCwd: string;
  let originalSessionDir: string;
  let originalQuiet: boolean;
  let originalJsonOutput: boolean;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testRoot = path.join(process.cwd(), '.vitest-hooks-lifecycle');
    fs.mkdirSync(testRoot, { recursive: true });
    projectDir = fs.mkdtempSync(path.join(testRoot, 'project-'));
    homeDir = fs.mkdtempSync(path.join(testRoot, 'home-'));
    originalCwd = config.cwd;
    originalSessionDir = config.sessionDir;
    originalQuiet = config.quiet;
    originalJsonOutput = config.jsonOutput;
    config.cwd = projectDir;
    config.sessionDir = path.join(projectDir, '.sessions');
    config.quiet = true;
    config.jsonOutput = false;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    streamChatMock.mockReset();
    hookManager.replaceHooks([], projectDir);
    spawnState.calls.length = 0;
    spawnState.queue.length = 0;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    hookManager.replaceHooks([], originalCwd);
    config.cwd = originalCwd;
    config.sessionDir = originalSessionDir;
    config.quiet = originalQuiet;
    config.jsonOutput = originalJsonOutput;
    vi.clearAllMocks();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore transient Windows file locks from recently-written files.
    }
  });

  it('loads hooks from global and project config files', async () => {
    writeJson(path.join(homeDir, '.icopilot', 'hooks.json'), {
      hooks: [{ event: 'sessionStart', command: 'global-hook' }],
    });
    writeJson(path.join(projectDir, '.icopilot', 'hooks.json'), {
      hooks: [{ event: 'preToolUse', command: 'project-hook', timeout: 1234 }],
    });

    const manager = new HookManager({ homeDir });
    await manager.loadHooks(projectDir);

    expect(manager.getHooks()).toEqual([
      { event: 'sessionStart', command: 'global-hook', timeout: undefined },
      { event: 'preToolUse', command: 'project-hook', timeout: 1234 },
    ]);
  });

  it('passes JSON payloads to stdin and merges modifications across hooks', async () => {
    const manager = new HookManager({ homeDir });
    manager.replaceHooks(
      [
        { event: 'userPromptSubmit', command: 'rewrite-prompt' },
        { event: 'userPromptSubmit', command: 'append-language' },
      ],
      projectDir,
    );
    spawnState.queue.push(
      { stdout: '{"action":"modify","modifications":{"prompt":"rewritten","tone":"short"}}' },
      { stdout: '{"action":"modify","modifications":{"language":"ts"}}' },
    );

    const result = await manager.emit('userPromptSubmit', { prompt: 'original prompt' });

    expect(JSON.parse(spawnState.calls[0]?.stdin ?? '{}')).toEqual({ prompt: 'original prompt' });
    expect(JSON.parse(spawnState.calls[1]?.stdin ?? '{}')).toMatchObject({ prompt: 'rewritten' });
    expect(result).toEqual({
      action: 'modify',
      reason: undefined,
      modifications: { prompt: 'rewritten', tone: 'short', language: 'ts' },
    });
  });

  it('supports plain-text continue results and deny decisions', async () => {
    const manager = new HookManager({ homeDir });
    manager.replaceHooks([{ event: 'sessionStart', command: 'echo-start' }], projectDir);
    spawnState.queue.push({ stdout: 'Session started' });

    await expect(manager.emit('sessionStart', { cwd: projectDir })).resolves.toEqual({
      action: 'continue',
      reason: 'Session started',
    });

    manager.replaceHooks([{ event: 'preToolUse', command: 'deny-tool' }], projectDir);
    spawnState.queue.push({ stdout: '{"action":"deny","reason":"shell blocked"}' });

    await expect(manager.emit('preToolUse', { tool: 'run_shell' })).resolves.toEqual({
      action: 'deny',
      reason: 'shell blocked',
      modifications: undefined,
    });
  });

  it('times out long-running hooks without crashing the caller', async () => {
    const manager = new HookManager({ homeDir });
    manager.replaceHooks(
      [{ event: 'sessionEnd', command: 'hang-forever', timeout: 10 }],
      projectDir,
    );
    spawnState.queue.push({ hang: true });

    const result = await manager.emit('sessionEnd', { cwd: projectDir });

    expect(result.action).toBe('continue');
    expect(result.reason).toContain('timed out');
    expect(spawnState.calls[0]?.killed).toBe(true);
  });
});

describe('lifecycle hook wiring', () => {
  let testRoot: string;
  let projectDir: string;
  let originalCwd: string;
  let originalSessionDir: string;
  let originalQuiet: boolean;
  let originalJsonOutput: boolean;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testRoot = path.join(process.cwd(), '.vitest-hooks-lifecycle');
    fs.mkdirSync(testRoot, { recursive: true });
    projectDir = fs.mkdtempSync(path.join(testRoot, 'project-'));
    originalCwd = config.cwd;
    originalSessionDir = config.sessionDir;
    originalQuiet = config.quiet;
    originalJsonOutput = config.jsonOutput;
    config.cwd = projectDir;
    config.sessionDir = path.join(projectDir, '.sessions');
    config.quiet = true;
    config.jsonOutput = false;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    streamChatMock.mockReset();
    hookManager.replaceHooks([], projectDir);
    spawnState.calls.length = 0;
    spawnState.queue.length = 0;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    hookManager.replaceHooks([], originalCwd);
    config.cwd = originalCwd;
    config.sessionDir = originalSessionDir;
    config.quiet = originalQuiet;
    config.jsonOutput = originalJsonOutput;
    vi.clearAllMocks();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore transient Windows file locks from recently-written files.
    }
  });

  it('blocks tool execution when a preToolUse hook denies the call', async () => {
    hookManager.replaceHooks([{ event: 'preToolUse', command: 'deny-read' }], projectDir);
    spawnState.queue.push({ stdout: '{"action":"deny","reason":"read_file disabled"}' });
    fs.writeFileSync(path.join(projectDir, 'sample.txt'), 'hello', 'utf8');

    const result = JSON.parse(await dispatchTool('read_file', { path: 'sample.txt' }));

    expect(result.error).toContain('read_file disabled');
  });

  it('allows postToolUse hooks to replace tool output', async () => {
    hookManager.replaceHooks([{ event: 'postToolUse', command: 'rewrite-output' }], projectDir);
    spawnState.queue.push({
      stdout:
        '{"action":"modify","modifications":{"output":"{\\"ok\\":true,\\"source\\":\\"hook\\"}"}}',
    });
    fs.writeFileSync(path.join(projectDir, 'sample.txt'), 'hello', 'utf8');

    const result = JSON.parse(await dispatchTool('read_file', { path: 'sample.txt' }));

    expect(result).toEqual({ ok: true, source: 'hook' });
  });

  it('applies userPromptSubmit modifications before sending prompts to the model', async () => {
    hookManager.replaceHooks(
      [{ event: 'userPromptSubmit', command: 'rewrite-user-prompt' }],
      projectDir,
    );
    spawnState.queue.push({
      stdout: '{"action":"modify","modifications":{"prompt":"rewritten prompt"}}',
    });
    streamChatMock.mockResolvedValue({ content: 'done', toolCalls: [], finishReason: 'stop' });
    const state = {
      id: 'session-1',
      createdAt: new Date().toISOString(),
      cwd: projectDir,
      mode: 'ask' as const,
      model: 'gpt-test',
      messages: [] as Array<Record<string, unknown>>,
      todos: [],
      pinned: [],
      gitContext: [],
    };
    const session = {
      state,
      push(message: Record<string, unknown>) {
        state.messages.push(message);
      },
    } as unknown as Session;

    await runTurn({
      session,
      userInput: 'original prompt',
      signal: new AbortController().signal,
    });

    expect(session.state.messages[0]).toMatchObject({
      role: 'user',
      content: 'rewritten prompt',
    });
    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
