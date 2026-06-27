import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import { dispatchTool, TOOL_SCHEMAS } from '../../src/tools/registry.js';
import { runInTerminal } from '../../src/tools/run-in-terminal.js';

let originalCwd: string;
let originalJsonOutput: boolean;
let testRoot: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalCwd = config.cwd;
  originalJsonOutput = config.jsonOutput;
  testRoot = fs.mkdtempSync(path.join(process.cwd(), '.test-run-in-terminal-'));
  config.cwd = testRoot;
  config.jsonOutput = false;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  config.cwd = originalCwd;
  config.jsonOutput = originalJsonOutput;
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Ignore transient Windows file locks from timed-out child processes.
  }
  vi.restoreAllMocks();
});

describe('runInTerminal', () => {
  it('streams stdout and returns the captured output', async () => {
    const result = await runInTerminal({ command: 'echo hello' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.stderr).toBe('');
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(output(stdoutSpy)).toContain('hello');
  });

  it('supports cwd and env overrides', async () => {
    fs.mkdirSync(path.join(testRoot, 'nested'), { recursive: true });

    const result = await runInTerminal({
      command: `${quoteForShell(process.execPath)} -e "process.stdout.write(process.cwd() + '\\n' + (process.env.ICLI_TEST_VALUE || ''))"`,
      cwd: 'nested',
      env: { ICLI_TEST_VALUE: 'from-env' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(path.join(testRoot, 'nested'));
    expect(result.stdout).toContain('from-env');
  });

  it('marks timed out commands', async () => {
    const result = await runInTerminal({
      command: `${quoteForShell(process.execPath)} -e "setTimeout(() => process.stdout.write('late'), 1000)"`,
      timeout: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('truncates captured output after 10KB', async () => {
    const result = await runInTerminal({
      command: `${quoteForShell(process.execPath)} -e "process.stdout.write('x'.repeat(12000))"`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(10 * 1024);
    expect(result.stdout).toContain('output truncated after 10KB');
  });
});

describe('run_in_terminal registry wiring', () => {
  it('registers the schema and dispatches the built-in tool', async () => {
    expect(TOOL_SCHEMAS.some((schema) => schema.function.name === 'run_in_terminal')).toBe(true);

    const result = JSON.parse(await dispatchTool('run_in_terminal', { command: 'echo registry' }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('registry');
  });
});

function output(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map(([chunk]) => String(chunk)).join('');
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
