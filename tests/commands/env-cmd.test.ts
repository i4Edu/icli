import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { envCommand, maskSecret } from '../../src/commands/env-cmd.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const execFileSyncMock = vi.mocked(execFileSync);
const ORIGINAL_ENV = { ...process.env };

describe('envCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GITHUB_TOKEN;
    delete process.env.ICOPILOT_MODEL;
    delete process.env.ICOPILOT_THEME;
    delete process.env.ICOPILOT_SANDBOX;
    delete process.env.ICOPILOT_DEBUG;
    delete process.env.ICOPILOT_EXTRA;
    delete process.env.SHELL;
    delete process.env.ComSpec;
    delete process.env.TEST_VAR;
    execFileSyncMock.mockImplementation(() => 'feature/env\n');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('masks secrets with various lengths', () => {
    expect(maskSecret('1234567')).toBe('***');
    expect(maskSecret('12345678')).toBe('1234***78');
    expect(maskSecret('abcdefghijklmnopqrstuvwxyz')).toBe('abcd***yz');
  });

  it('shows default environment keys', () => {
    process.env.GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz';
    process.env.ICOPILOT_MODEL = 'gpt-4o-mini';
    process.env.ICOPILOT_THEME = 'dark';
    process.env.ICOPILOT_SANDBOX = '1';
    process.env.ICOPILOT_DEBUG = 'true';
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    process.env.HOME = 'C:\\Users\\tester';

    const output = envCommand([]);

    expect(output).toContain('Environment context');
    expect(output).toContain('GITHUB_TOKEN');
    expect(output).toContain('ghp_***yz');
    expect(output).toContain('ICOPILOT_MODEL');
    expect(output).toContain('ICOPILOT_THEME');
    expect(output).toContain('ICOPILOT_SANDBOX');
    expect(output).toContain('ICOPILOT_DEBUG');
    expect(output).toContain('SHELL / ComSpec');
    expect(output).toContain('NODE_VERSION');
    expect(output).toContain('CWD');
    expect(output).toContain('HOME');
    expect(output).toContain('Git branch');
    expect(output).toContain('feature/env');
  });

  it('shows all icopilot variables with --full', () => {
    process.env.ICOPILOT_MODEL = 'gpt-4o-mini';
    process.env.ICOPILOT_THEME = 'light';
    process.env.ICOPILOT_EXTRA = 'enabled';

    const output = envCommand(['--full']);

    expect(output).toContain('iCopilot environment');
    expect(output).toContain('ICOPILOT_MODEL');
    expect(output).toContain('ICOPILOT_THEME');
    expect(output).toContain('ICOPILOT_EXTRA');
  });

  it('checks whether a variable is set', () => {
    process.env.TEST_VAR = 'present';

    expect(envCommand(['--check', 'TEST_VAR'])).toContain('present');
    expect(envCommand(['--check', 'MISSING_VAR'])).toContain('(not set)');
  });
});
