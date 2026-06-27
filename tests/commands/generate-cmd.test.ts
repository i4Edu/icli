import { afterEach, describe, expect, it } from 'vitest';
import { buildGeneratePrompt, detectShell } from '../../src/commands/generate-cmd.js';

const originalShell = process.env.SHELL;
const originalTermProgram = process.env.TERM_PROGRAM;
const originalComSpec = process.env.ComSpec;
const originalICopilotShell = process.env.ICOPILOT_SHELL;

function restoreEnv(): void {
  setEnvValue('SHELL', originalShell);
  setEnvValue('TERM_PROGRAM', originalTermProgram);
  setEnvValue('ComSpec', originalComSpec);
  setEnvValue('ICOPILOT_SHELL', originalICopilotShell);
}

function setEnvValue(
  key: 'SHELL' | 'TERM_PROGRAM' | 'ComSpec' | 'ICOPILOT_SHELL',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

afterEach(() => {
  restoreEnv();
});

describe('detectShell', () => {
  it.each([
    ['/bin/bash', 'bash'],
    ['/bin/zsh', 'zsh'],
    ['/usr/bin/fish', 'fish'],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'pwsh'],
  ])('detects %s as %s', (shellPath, expected) => {
    process.env.SHELL = shellPath;
    delete process.env.TERM_PROGRAM;
    delete process.env.ComSpec;
    delete process.env.ICOPILOT_SHELL;

    expect(detectShell()).toBe(expected);
  });

  it('falls back to bash when no supported shell can be inferred', () => {
    delete process.env.SHELL;
    delete process.env.TERM_PROGRAM;
    delete process.env.ComSpec;
    delete process.env.ICOPILOT_SHELL;

    expect(detectShell()).toBe('bash');
  });
});

describe('buildGeneratePrompt', () => {
  it('includes the goal in the generated prompt', () => {
    const goal = 'set up python venv and install flask';
    const payload = buildGeneratePrompt(goal, 'bash');

    expect(payload.goal).toBe(goal);
    expect(payload.shell).toBe('bash');
    expect(payload.prompt).toContain(goal);
  });

  it('uses detected shell by default', () => {
    process.env.SHELL = '/bin/zsh';
    delete process.env.TERM_PROGRAM;
    delete process.env.ComSpec;
    delete process.env.ICOPILOT_SHELL;

    const payload = buildGeneratePrompt('install dependencies');

    expect(payload.shell).toBe('zsh');
    expect(payload.prompt).toContain('zsh');
  });
});
