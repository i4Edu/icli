import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { SmartFileSelector } from '../../src/context/smart-files.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = config.cwd;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-smart-files-'));
  config.cwd = tmpDir;
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'iCopilot Tests'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: tmpDir,
    stdio: 'ignore',
  });
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SmartFileSelector', () => {
  it('scores and sorts relevant files while respecting .gitignore', async () => {
    writeProjectFile('.gitignore', 'ignored/\n');
    writeProjectFile('src/context/smart-files.ts', 'export const smart = true;\n');
    writeProjectFile('src/context/large-context.ts', `${'x'.repeat(20_000)}\n`);
    writeProjectFile('docs/notes.md', '# Notes\n');
    writeProjectFile('ignored/smart-files.ts', 'export const ignored = true;\n');

    commitAll('initial files');
    writeProjectFile(
      'src/context/smart-files.ts',
      'export const smart = true;\nexport const selector = true;\n',
    );
    commitAll('refresh smart file');

    const selector = new SmartFileSelector(tmpDir);
    const selected = await selector.selectRelevant('smart files typescript context');

    expect(selected).not.toHaveLength(0);
    expect(selected[0]).toMatchObject({
      path: 'src/context/smart-files.ts',
      score: 21,
    });
    expect(selected[0].reason).toContain('exact filename match');
    expect(selected[0].reason).toContain('path component match');
    expect(selected[0].reason).toContain('extension relevance');
    expect(selected[0].reason).toContain('recently modified');
    expect(selected[0].reason).toContain('small file bonus');
    expect(selected.some((file) => file.path === 'ignored/smart-files.ts')).toBe(false);
    expect(selected.find((file) => file.path === 'src/context/large-context.ts')?.score).toBe(8);
  });

  it('excludes tests by default and can include them on demand', async () => {
    writeProjectFile('src/context/smart-files.ts', 'export const smart = true;\n');
    writeProjectFile('tests/context/smart-files.test.ts', 'export const smartTest = true;\n');
    commitAll('add smart files');

    const selector = new SmartFileSelector(tmpDir);
    const withoutTests = await selector.selectRelevant('smart files test typescript');
    const withTests = await selector.selectRelevant('smart files test typescript', {
      includeTests: true,
    });

    expect(withoutTests.some((file) => file.path === 'tests/context/smart-files.test.ts')).toBe(
      false,
    );
    expect(withTests.some((file) => file.path === 'tests/context/smart-files.test.ts')).toBe(true);
  });

  it('supports file pattern filtering, maxFiles, and disabling recent preference', async () => {
    writeProjectFile('src/context/smart-files.ts', 'export const smart = true;\n');
    writeProjectFile('src/context/smart-files.md', '# smart files\n');
    writeProjectFile('docs/smart-files.md', '# docs\n');
    commitAll('initial smart files');
    writeProjectFile(
      'src/context/smart-files.ts',
      'export const smart = true;\nexport const recent = true;\n',
    );
    commitAll('recent typescript change');

    const selector = new SmartFileSelector(tmpDir);
    const filtered = await selector.selectRelevant('smart files typescript', {
      filePattern: 'src/context/*',
      maxFiles: 2,
      preferRecent: false,
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.every((file) => file.path.startsWith('src/context/'))).toBe(true);
    expect(filtered[0].path).toBe('src/context/smart-files.ts');
    expect(filtered[0].score).toBe(19);
    expect(filtered[0].reason).not.toContain('recently modified');
  });
});

function writeProjectFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function commitAll(message: string): void {
  execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', message], { cwd: tmpDir, stdio: 'ignore' });
}
