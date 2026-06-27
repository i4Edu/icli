import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectTestFrameworks, testCommand } from '../../src/commands/test-cmd.js';

let tmpDir: string;

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), '.vitest-test-cmd-tmp'), { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.vitest-test-cmd-tmp', 'case-'));
});

afterEach(() => {
  fs.rmSync(path.join(process.cwd(), '.vitest-test-cmd-tmp'), { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('detectTestFrameworks', () => {
  it('returns no detectors for an empty dir', () => {
    expect(detectTestFrameworks(tmpDir)).toEqual([]);
  });

  it('detects package.json with a test script', () => {
    writeFixture('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'npm-test',
      command: 'npm test',
      reason: 'package.json has "scripts.test"',
    });
  });

  it('detects vitest config', () => {
    writeFixture('vitest.config.ts', 'export default {};\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'vitest',
      command: 'npx vitest run',
      reason: 'vitest.config.* is present',
    });
  });

  it('detects jest config', () => {
    writeFixture('jest.config.cjs', 'module.exports = {};\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'jest',
      command: 'npx jest',
      reason: 'jest.config.* is present',
    });
  });

  it('detects pytest from pyproject', () => {
    writeFixture('pyproject.toml', '[tool.pytest]\naddopts = "-q"\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'pytest',
      command: 'pytest',
      reason: 'pyproject.toml contains [tool.pytest]',
    });
  });

  it('detects Cargo.toml', () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'cargo-test',
      command: 'cargo test',
      reason: 'Cargo.toml is present',
    });
  });

  it('detects go tests from go.mod', () => {
    writeFixture('go.mod', 'module example.com/demo\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'go-test',
      command: 'go test ./...',
      reason: 'go.mod is present',
    });
  });

  it('detects go tests from *_test.go files', () => {
    writeFixture('pkg/sample_test.go', 'package pkg\n');

    expect(detectTestFrameworks(tmpDir)).toContainEqual({
      name: 'go-test-files',
      command: 'go test ./...',
      reason: 'found *_test.go files',
    });
  });

  it('formats detected frameworks for slash output', () => {
    writeFixture('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFixture('vitest.config.ts', 'export default {};\n');

    const output = testCommand(tmpDir);
    expect(output).toContain('Detected test frameworks');
    expect(output).toContain('npm-test');
    expect(output).toContain('npm test');
    expect(output).toContain('package.json has "scripts.test"');
    expect(output).toContain('vitest');
    expect(output).toContain('npx vitest run');
  });
});
