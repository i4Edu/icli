import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfHealingBuilder } from '../../src/agents/self-heal.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-self-heal-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SelfHealingBuilder', () => {
  it('detects the project typecheck command', () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        scripts: {
          typecheck: 'tsc -p . --noEmit',
          build: 'tsc -p .',
        },
      }),
    );

    const builder = new SelfHealingBuilder(tmpDir);
    expect(builder.detectBuildCommand(tmpDir)).toBe('npm run typecheck');
  });

  it('heals a TypeScript import extension error and retries', async () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        scripts: {
          typecheck: 'tsc -p . --noEmit',
        },
      }),
    );
    writeFixture(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ES2022' } }, null, 2),
    );
    writeFixture('src/helper.ts', 'export const helper = 1;\n');
    writeFixture(
      'src/main.ts',
      "import { helper } from './helper';\nexport const value = helper;\n",
    );

    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 2,
        stdout: '',
        stderr:
          "src/main.ts(1,24): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports. Did you mean './helper.js'?",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      });

    const builder = new SelfHealingBuilder(tmpDir, { runner });
    const result = await builder.healAndRetry(2);

    expect(result.success).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.applied).toBe(true);
    expect(result.attempts[0]?.fix).toContain('./helper.js');
    expect(readFixture('src/main.ts')).toContain('./helper.js');
    expect(runner).toHaveBeenNthCalledWith(1, 'npm run typecheck', tmpDir);
    expect(runner).toHaveBeenNthCalledWith(2, 'npm run typecheck', tmpDir);
  });

  it('applies a simple ESLint semicolon fix', async () => {
    writeFixture('src/lint.ts', 'const answer = 42\n');

    const runner = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: `${path.join('src', 'lint.ts')}:1:18: error Missing semicolon. (semi)`,
      stderr: '',
    });

    const builder = new SelfHealingBuilder(tmpDir, { runner });
    const build = await builder.build('npm run lint');
    const attempts = builder.diagnose(build.errors);
    const applied = await builder.applyFix(attempts[0]!);

    expect(applied).toBe(true);
    expect(readFixture('src/lint.ts')).toBe('const answer = 42;\n');
  });

  it('parses runtime import errors', async () => {
    writeFixture('src/main.ts', "import './helper';\n");

    const missingPath = path.join(tmpDir, 'src', 'helper');
    const runner = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${missingPath}' imported from ${path.join(tmpDir, 'src', 'main.ts')}`,
    });

    const builder = new SelfHealingBuilder(tmpDir, { runner });
    const build = await builder.build('node src/main.ts');

    expect(build.errors).toHaveLength(1);
    expect(build.errors[0]).toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
      file: path.join(tmpDir, 'src', 'main.ts'),
      severity: 'error',
    });
    expect(builder.diagnose(build.errors)[0]?.diagnosis).toContain('runtime import path');
  });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFixture(relativePath: string): string {
  return fs.readFileSync(path.join(tmpDir, relativePath), 'utf8');
}
