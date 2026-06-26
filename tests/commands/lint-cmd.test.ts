import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLinters } from '../../src/commands/lint-cmd.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-lint-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('detectLinters', () => {
  it('returns no detectors for an empty dir', () => {
    expect(detectLinters(tmpDir)).toEqual([]);
  });

  it('detects package.json with a lint script', () => {
    writeFixture('package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }));

    expect(detectLinters(tmpDir)).toContainEqual({
      name: 'npm-lint',
      command: 'npm run lint',
      reason: 'package.json has "scripts.lint"',
    });
  });

  it('detects package.json without a lint script but with eslint devDependency', () => {
    writeFixture('package.json', JSON.stringify({ devDependencies: { eslint: '^8.0.0' } }));

    expect(detectLinters(tmpDir)).toContainEqual({
      name: 'eslint',
      command: 'eslint .',
      reason: 'package.json has eslint as a dependency',
    });
  });

  it('detects .eslintrc.cjs present alone', () => {
    writeFixture('.eslintrc.cjs', 'module.exports = {};');

    expect(detectLinters(tmpDir)).toContainEqual({
      name: 'eslint-config',
      command: 'npx eslint .',
      reason: '.eslintrc* is present',
    });
  });

  it('detects pyproject.toml with [tool.ruff]', () => {
    writeFixture('pyproject.toml', '[tool.ruff]\nline-length = 100\n');

    expect(detectLinters(tmpDir)).toContainEqual({
      name: 'ruff',
      command: 'ruff check .',
      reason: 'ruff configuration is present',
    });
  });

  it('detects Cargo.toml', () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');

    expect(detectLinters(tmpDir)).toContainEqual({
      name: 'cargo-clippy',
      command: 'cargo clippy --all-targets -- -D warnings',
      reason: 'Cargo.toml is present',
    });
  });
});
