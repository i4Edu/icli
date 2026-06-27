import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDepsPayload, detectPackageManager } from '../../src/commands/deps-cmd.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-deps-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content = ''): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('detectPackageManager', () => {
  it.each([
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['Cargo.lock', 'cargo'],
    ['go.sum', 'go'],
    ['requirements.txt', 'pip'],
    ['Pipfile.lock', 'pip'],
    ['Gemfile.lock', 'bundler'],
  ])('detects %s as %s', (fileName, expected) => {
    writeFixture(fileName);
    expect(detectPackageManager(tmpDir)).toBe(expected);
  });
});

describe('buildDepsPayload', () => {
  it('builds payload from package.json dependencies and devDependencies', () => {
    writeFixture('package-lock.json');
    writeFixture(
      'package.json',
      JSON.stringify({
        dependencies: {
          chalk: '^5.3.0',
          commander: '^12.1.0',
        },
        devDependencies: {
          vitest: '^1.6.0',
        },
      }),
    );

    const payload = buildDepsPayload(tmpDir);
    if ('error' in payload) throw new Error(payload.error);

    expect(payload.packageManager).toBe('npm');
    expect(payload.dependencies).toEqual([
      { name: 'chalk', current: '^5.3.0', type: 'prod' },
      { name: 'commander', current: '^12.1.0', type: 'prod' },
      { name: 'vitest', current: '^1.6.0', type: 'dev' },
    ]);
    expect(payload.prompt).toContain('Analyze this npm dependency list');
    expect(payload.prompt).toContain('- [prod] chalk: ^5.3.0');
    expect(payload.prompt).toContain('- [dev] vitest: ^1.6.0');
  });

  it('returns an error when no supported package manager is detected', () => {
    expect(buildDepsPayload(tmpDir)).toEqual({
      error: 'No supported package manager detected in the current directory.',
    });
  });
});
