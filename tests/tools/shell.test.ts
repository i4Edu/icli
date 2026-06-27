import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { confirm, input } from '@inquirer/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import { toolMemory } from '../../src/tools/memory.js';
import { checkCommandSafety } from '../../src/tools/safety.js';
import { proposeAndRun } from '../../src/tools/shell.js';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  input: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../src/tools/safety.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/tools/safety.js')>(
    '../../src/tools/safety.js',
  );
  return {
    ...actual,
    checkCommandSafety: vi.fn(),
  };
});

const spawnMock = vi.mocked(spawn);
const confirmMock = vi.mocked(confirm);
const inputMock = vi.mocked(input);
const safetyMock = vi.mocked(checkCommandSafety);

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let originalCwd: string;

beforeEach(() => {
  originalCwd = config.cwd;
  config.cwd = 'E:\\AI\\icli';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  toolMemory.allowShell.clear();
  confirmMock.mockReset();
  inputMock.mockReset();
  spawnMock.mockReset();
  safetyMock.mockReset();
  safetyMock.mockReturnValue({ dangerous: false, level: 'safe', reason: '' });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  vi.restoreAllMocks();
  config.cwd = originalCwd;
});

describe('proposeAndRun safety integration', () => {
  it('shows a warning and uses the normal confirmation prompt for warn-level commands', async () => {
    safetyMock.mockReturnValue({
      dangerous: true,
      level: 'warn',
      reason: 'force push may overwrite remote history',
    });
    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockSpawnSuccess();

    const result = await proposeAndRun('git push --force origin main');

    expect(result).toMatchObject({ ran: true, exitCode: 0 });
    expect(safetyMock).toHaveBeenCalledWith('git push --force origin main');
    expect(confirmMock).toHaveBeenNthCalledWith(1, {
      message: 'Run this command?',
      default: false,
    });
    expect(output()).toContain('Warning: force push may overwrite remote history');
  });

  it('requires typing yes for critical commands before running', async () => {
    safetyMock.mockReturnValue({
      dangerous: true,
      level: 'critical',
      reason: 'recursive delete of root/home',
    });
    inputMock.mockResolvedValueOnce('yes');
    confirmMock.mockResolvedValueOnce(false);
    mockSpawnSuccess();

    const result = await proposeAndRun('rm -rf /');

    expect(result).toMatchObject({ ran: true, exitCode: 0 });
    expect(inputMock).toHaveBeenCalledWith({
      message: 'Type "yes" to run this critical command:',
      default: '',
    });
    expect(confirmMock).toHaveBeenCalledWith({
      message: 'Remember this command for the session?',
      default: false,
    });
    expect(output()).toContain('!!! CRITICAL COMMAND WARNING !!!');
    expect(output()).toContain('Reason: recursive delete of root/home');
  });
});

function mockSpawnSuccess(): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child as unknown as ReturnType<typeof spawn>;
  });
}

function output(): string {
  return stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
}
