import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDiagnostics, runDiagnostics } from '../../src/commands/doctor-cmd.js';

let sandboxRoot: string;
let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let originalGithubToken: string | undefined;
let originalSessionDir: string | undefined;

beforeEach(() => {
  originalGithubToken = process.env.GITHUB_TOKEN;
  originalSessionDir = process.env.ICOPILOT_SESSION_DIR;

  sandboxRoot = path.join(
    process.cwd(),
    '.vitest-doctor-cmd-tmp',
    String(process.pid),
    String(Date.now()),
  );
  fakeHome = path.join(sandboxRoot, 'home');

  fs.mkdirSync(fakeHome, { recursive: true });
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
});

afterEach(() => {
  homedirSpy.mockRestore();

  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }

  if (originalSessionDir === undefined) {
    delete process.env.ICOPILOT_SESSION_DIR;
  } else {
    process.env.ICOPILOT_SESSION_DIR = originalSessionDir;
  }

  fs.rmSync(path.join(process.cwd(), '.vitest-doctor-cmd-tmp'), { recursive: true, force: true });
});

describe('runDiagnostics', () => {
  it('reports GITHUB_TOKEN as fail when unset', () => {
    delete process.env.GITHUB_TOKEN;

    const tokenCheck = runDiagnostics().find((check) => check.name === 'GITHUB_TOKEN');

    expect(tokenCheck).toMatchObject({
      name: 'GITHUB_TOKEN',
      status: 'fail',
      message: 'not set',
    });
  });

  it('reports GITHUB_TOKEN as ok when set', () => {
    process.env.GITHUB_TOKEN = 'test-token';

    const tokenCheck = runDiagnostics().find((check) => check.name === 'GITHUB_TOKEN');

    expect(tokenCheck).toMatchObject({
      name: 'GITHUB_TOKEN',
      status: 'ok',
      message: 'set',
    });
  });
});

describe('formatDiagnostics', () => {
  it('includes all check names in formatted output', () => {
    process.env.GITHUB_TOKEN = 'test-token';
    fs.mkdirSync(path.join(fakeHome, '.icopilot'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.icopilotrc.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(fakeHome, '.icopilot', 'mcp.json'), '{"servers":{}}', 'utf8');

    const checks = runDiagnostics();
    const output = formatDiagnostics(checks);

    for (const check of checks) {
      expect(output).toContain(check.name);
    }
  });
});
