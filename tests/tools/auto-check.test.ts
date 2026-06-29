import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import {
  buildAutoFixPrompt,
  detectAutoLintCommand,
  detectAutoTestCommand,
  extractChangedFilesFromToolResult,
  runAutoLint,
  runAutoTest,
} from '../../src/tools/auto-check.js';

let tmpRoot: string;
let workspaceDir: string;
let originalCwd: string;
let originalLintCmd: string;
let originalTestCmd: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), 'tests', '.tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  workspaceDir = fs.mkdtempSync(path.join(tmpRoot, 'auto-check-'));
  originalCwd = config.cwd;
  originalLintCmd = config.lintCmd;
  originalTestCmd = config.testCmd;
  config.cwd = workspaceDir;
  config.lintCmd = '';
  config.testCmd = '';
});

afterEach(() => {
  config.cwd = originalCwd;
  config.lintCmd = originalLintCmd;
  config.testCmd = originalTestCmd;
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  } catch {
    // Ignore transient Windows locks from child processes.
  }
});

describe('auto-check', () => {
  it('runs detected auto-lint commands for changed files', async () => {
    writeFile('lint-ok.cjs', `process.stdout.write('lint ok');\n`);
    config.lintCmd = `node lint-ok.cjs`;
    writeFile('package.json', JSON.stringify({ scripts: { lint: 'eslint "src/**/*.ts"' } }));
    writeFile('src/example.ts', 'export const example = 1;\n');

    const result = await runAutoLint(['src/example.ts']);

    expect(result.passed).toBe(true);
    expect(result.output).toContain('lint ok');
    expect(result.fixable).toBe(false);
    expect(detectAutoLintCommand(workspaceDir)).toBe('node lint-ok.cjs');
  });

  it('reports failing auto-lint commands as fixable', async () => {
    writeFile('lint-fail.cjs', `process.stderr.write('lint failed'); process.exit(1);\n`);
    config.lintCmd = `node lint-fail.cjs`;
    writeFile('src/example.ts', 'export const example = 1;\n');

    const result = await runAutoLint(['src/example.ts']);

    expect(result.passed).toBe(false);
    expect(result.output).toContain('lint failed');
    expect(result.fixable).toBe(true);
  });

  it('runs detected auto-test commands', async () => {
    writeFile('test-ok.cjs', `process.stdout.write('tests ok');\n`);
    config.testCmd = `node test-ok.cjs`;

    const result = await runAutoTest();

    expect(result.passed).toBe(true);
    expect(result.output).toContain('tests ok');
    expect(detectAutoTestCommand(workspaceDir)).toBe('node test-ok.cjs');
  });

  it('supports configured lint command placeholders and fix prompts', async () => {
    writeFile('src/example.ts', 'export const example = 1;\n');
    writeFile(
      'lint-args.cjs',
      `process.stderr.write(process.argv.slice(2).join('|')); process.exit(1);\n`,
    );
    config.lintCmd = `node lint-args.cjs {files}`;

    const result = await runAutoLint(['src/example.ts']);
    const prompt = buildAutoFixPrompt('lint', result, 1, ['src/example.ts']);

    expect(result.passed).toBe(false);
    expect(result.output).toContain('src');
    expect(prompt).toContain('Retry 1/3');
    expect(prompt).toContain('src/example.ts');
  });

  it('extracts changed files from write-style tool payloads', () => {
    expect(
      extractChangedFilesFromToolResult(
        'write_file',
        { path: 'src/example.ts' },
        JSON.stringify({ wrote: true }),
      ),
    ).toEqual(['src/example.ts']);
    expect(
      extractChangedFilesFromToolResult(
        'apply_patch',
        {},
        JSON.stringify({
          applied: [{ path: 'src/example.ts' }, { path: 'tests/example.test.ts' }],
        }),
      ),
    ).toEqual(['src/example.ts', 'tests/example.test.ts']);
  });
});

function writeFile(relativePath: string, content: string): void {
  const filePath = path.join(workspaceDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
