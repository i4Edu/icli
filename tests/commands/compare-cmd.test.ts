import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareCommand, compareFiles } from '../../src/commands/compare-cmd.js';

let tmpDir: string;

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), '.vitest-compare-cmd-tmp'), { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.vitest-compare-cmd-tmp', 'case-'));
});

afterEach(() => {
  fs.rmSync(path.join(process.cwd(), '.vitest-compare-cmd-tmp'), { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): string {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('compareFiles', () => {
  it('builds a diff payload for files that differ', () => {
    writeFixture('left.ts', 'const value = 1;\nconsole.log(value);\n');
    writeFixture('right.ts', 'const value = 2;\nconsole.log(value);\nconsole.log("done");\n');

    const result = compareFiles('left.ts', 'right.ts', tmpDir);

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.fileA).toBe(path.join(tmpDir, 'left.ts'));
    expect(result.fileB).toBe(path.join(tmpDir, 'right.ts'));
    expect(result.diff).toContain('--- left.ts');
    expect(result.diff).toContain('+++ right.ts');
    expect(result.diff).toContain('-const value = 1;');
    expect(result.diff).toContain('+const value = 2;');
    expect(result.prompt).toContain('Analyze the differences between these two files.');
    expect(result.prompt).toContain(result.fileA);
    expect(result.prompt).toContain(result.fileB);
  });

  it('returns an error when a file is missing', () => {
    writeFixture('left.ts', 'const value = 1;\n');

    expect(compareFiles('left.ts', 'missing.ts', tmpDir)).toEqual({
      error: `file not found: ${path.join(tmpDir, 'missing.ts')}`,
    });
  });

  it('calculates stats for additions, deletions, and unchanged lines', () => {
    writeFixture('left.ts', 'alpha\nbeta\ngamma\n');
    writeFixture('right.ts', 'alpha\nBETA\ngamma\ndelta\n');

    const result = compareFiles('left.ts', 'right.ts', tmpDir);

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.stats).toEqual({
      linesA: 3,
      linesB: 4,
      additions: 2,
      deletions: 1,
      unchanged: 2,
    });
  });
});

describe('compareCommand', () => {
  it('shows no changes for identical files', () => {
    writeFixture('same-a.ts', 'export const value = 1;\n');
    writeFixture('same-b.ts', 'export const value = 1;\n');

    const output = compareCommand(['same-a.ts', 'same-b.ts'], tmpDir);

    expect(output).toContain('No content changes detected.');
    expect(output).toContain('A:1');
    expect(output).toContain('B:1');
    expect(output).toContain('+0');
    expect(output).toContain('-0');
    expect(output).toContain('=1');
  });
});
