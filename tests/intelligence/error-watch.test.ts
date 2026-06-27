import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockChildProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

function waitFor(condition: () => boolean, timeoutMs = 1_000, intervalMs = 10): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for condition'));
      }
    }, intervalMs);
  });
}

async function loadErrorWatchModule() {
  let child: MockChildProcess | undefined;

  vi.resetModules();
  vi.doMock('node:child_process', () => ({
    spawn: vi.fn(() => {
      child = createMockChildProcess();
      return child;
    }),
  }));

  const mod = await import('../../src/intelligence/error-watch.js');
  return {
    ...mod,
    getChild: () => child as MockChildProcess,
  };
}

describe('ErrorWatcher', { timeout: 10_000 }, () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdout = '';

  beforeEach(() => {
    stdout = '';
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('parses TypeScript errors and notifies callbacks', async () => {
    const { ErrorWatcher, getChild } = await loadErrorWatchModule();
    const watcher = new ErrorWatcher();
    const seen: string[] = [];

    watcher.onError((error) => seen.push(error.message));
    watcher.start('npm run build');

    const child = getChild();
    child.stderr.write(`src/example.ts(12,8): error TS2304: Cannot find name 'missingValue'.\n`);
    child.emit('close', 1);

    await waitFor(() => watcher.getErrors().length === 1);

    expect(watcher.getErrors()[0]).toMatchObject({
      file: 'src/example.ts',
      line: 12,
      column: 8,
      severity: 'error',
      code: 'TS2304',
      message: `Cannot find name 'missingValue'.`,
    });
    expect(seen).toEqual([`Cannot find name 'missingValue'.`]);
  });

  it('parses ESLint and generic errors and deduplicates repeated lines', async () => {
    const { ErrorWatcher, getChild } = await loadErrorWatchModule();
    const watcher = new ErrorWatcher();

    watcher.start('npm run lint');

    const child = getChild();
    child.stdout.write(`src/example.ts:4:2: warning Unexpected console statement (no-console)\n`);
    child.stderr.write(`Error: build failed\n`);
    child.stderr.write(`Error: build failed\n`);
    child.emit('close', 1);

    await waitFor(() => watcher.getErrors().length === 2);

    expect(watcher.getErrors()).toEqual([
      {
        file: 'src/example.ts',
        line: 4,
        column: 2,
        severity: 'warning',
        code: 'no-console',
        message: 'Unexpected console statement',
        raw: 'src/example.ts:4:2: warning Unexpected console statement (no-console)',
      },
      {
        severity: 'error',
        message: 'build failed',
        raw: 'Error: build failed',
      },
    ]);

    watcher.clear();
    expect(watcher.getErrors()).toEqual([]);
  });

  it('builds actionable fix suggestions', async () => {
    const { suggestFix } = await loadErrorWatchModule();

    const suggestion = suggestFix({
      file: 'src/example.ts',
      line: 7,
      column: 3,
      severity: 'error',
      code: 'TS2322',
      message: "Type 'number' is not assignable to type 'string'.",
      raw: `src/example.ts(7,3): error TS2322: Type 'number' is not assignable to type 'string'.`,
    });

    expect(suggestion).toContain('src/example.ts:7:3');
    expect(suggestion).toContain('TS2322');
    expect(suggestion).toContain('expected and actual types');
    expect(suggestion).toContain('smallest safe code change');
  });

  it('wires /error-watch into slash help and completion metadata', () => {
    const slashSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'commands', 'slash.ts'),
      'utf8',
    );
    const completionSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'util', 'completion.ts'),
      'utf8',
    );

    expect(slashSource).toContain(`/error-watch <action>`);
    expect(slashSource).toContain(`case 'error-watch'`);
    expect(slashSource).toContain(`/error-watch start <cmd>`);
    expect(completionSource).toContain(`'error-watch'`);
  });
});
