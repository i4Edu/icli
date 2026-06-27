import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import {
  applyDiffBlocks,
  parseDiffBlocks,
  type ApplyResult,
  type DiffBlock,
} from '../../src/tools/diff-edit.js';

let tempRoot: string;
let workspaceDir: string;
let originalCwd: string;

beforeEach(() => {
  tempRoot = path.join(process.cwd(), 'tests', '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  workspaceDir = fs.mkdtempSync(path.join(tempRoot, 'diff-edit-'));
  originalCwd = config.cwd;
  config.cwd = workspaceDir;
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

describe('parseDiffBlocks', () => {
  it('parses a single SEARCH/REPLACE block', () => {
    const blocks = parseDiffBlocks(`<<<<<<< SEARCH
filepath: src/example.ts
const value = 1;
=======
const value = 2;
>>>>>>> REPLACE`);

    expect(blocks).toEqual([
      {
        filePath: 'src/example.ts',
        search: 'const value = 1;',
        replace: 'const value = 2;',
      },
    ]);
  });

  it('parses multiple blocks for the same file', () => {
    const blocks = parseDiffBlocks(`Before
<<<<<<< SEARCH
filepath: src/example.ts
const one = 1;
=======
const one = 2;
>>>>>>> REPLACE

<<<<<<< SEARCH
filepath: src/example.ts
const two = 2;
=======
const two = 3;
>>>>>>> REPLACE
After`);

    expect(blocks).toEqual([
      {
        filePath: 'src/example.ts',
        search: 'const one = 1;',
        replace: 'const one = 2;',
      },
      {
        filePath: 'src/example.ts',
        search: 'const two = 2;',
        replace: 'const two = 3;',
      },
    ]);
  });

  it('parses multiple files', () => {
    const blocks = parseDiffBlocks(`<<<<<<< SEARCH
filepath: src/one.ts
alpha
=======
ALPHA
>>>>>>> REPLACE
<<<<<<< SEARCH
filepath: src/two.ts
beta
=======
BETA
>>>>>>> REPLACE`);

    expect(blocks).toEqual([
      { filePath: 'src/one.ts', search: 'alpha', replace: 'ALPHA' },
      { filePath: 'src/two.ts', search: 'beta', replace: 'BETA' },
    ]);
  });
});

describe('applyDiffBlocks', () => {
  it('applies blocks to real files, including multiple blocks per file', () => {
    const filePath = path.join(workspaceDir, 'src', 'example.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      ['const one = 1;', 'const two = 2;', 'export const sum = one + two;', ''].join('\n'),
      'utf8',
    );

    const blocks: DiffBlock[] = [
      { filePath: 'src/example.ts', search: 'const one = 1;', replace: 'const one = 10;' },
      { filePath: 'src/example.ts', search: 'const two = 2;', replace: 'const two = 20;' },
    ];

    expect(applyDiffBlocks(blocks)).toEqual<ApplyResult[]>([
      { filePath: 'src/example.ts', success: true },
      { filePath: 'src/example.ts', success: true },
    ]);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      ['const one = 10;', 'const two = 20;', 'export const sum = one + two;', ''].join('\n'),
    );
  });

  it('uses fuzzy matching for whitespace differences and blank-line edges', () => {
    const filePath = path.join(workspaceDir, 'src', 'fuzzy.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      ['function demo() {', '  const value = 1;', '  return value;', '}', ''].join('\n'),
      'utf8',
    );

    const results = applyDiffBlocks([
      {
        filePath: 'src/fuzzy.ts',
        search: ['', 'const   value = 1;', 'return value;', ''].join('\n'),
        replace: 'const value = 2;\nreturn value + 1;',
      },
    ]);

    expect(results).toEqual([{ filePath: 'src/fuzzy.ts', success: true }]);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      ['function demo() {', 'const value = 2;', 'return value + 1;', '}', ''].join('\n'),
    );
  });

  it('returns an error when search text is not found', () => {
    const filePath = path.join(workspaceDir, 'src', 'missing.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const value = 1;\n', 'utf8');

    const results = applyDiffBlocks([
      {
        filePath: 'src/missing.ts',
        search: 'const value = 2;',
        replace: 'const value = 3;',
      },
    ]);

    expect(results[0]).toEqual({
      filePath: 'src/missing.ts',
      success: false,
      error: 'search text not found in src/missing.ts',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 1;\n');
  });

  it('returns an error when fuzzy matching is ambiguous', () => {
    const filePath = path.join(workspaceDir, 'src', 'ambiguous.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, ['  value = 1;', '', 'value = 1;', ''].join('\n'), 'utf8');

    const results = applyDiffBlocks([
      {
        filePath: 'src/ambiguous.ts',
        search: 'value = 1;',
        replace: 'value = 2;',
      },
    ]);

    expect(results[0]).toEqual({
      filePath: 'src/ambiguous.ts',
      success: false,
      error: 'search text matched multiple locations in src/ambiguous.ts',
    });
  });
});
