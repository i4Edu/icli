import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { parseFileRefs, renderFileRefBlock } from '../../src/context/file-refs.js';

const MAX_BYTES = 256 * 1024;

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = config.cwd;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-file-refs-'));
  config.cwd = tmpDir;
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseFileRefs', () => {
  it('loads @path references and deduplicates repeated refs', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'hello.ts'), 'export const hello = 1;\n');

    const refs = parseFileRefs('please read @src/hello.ts and again @src/hello.ts');

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ raw: '@src/hello.ts', rel: 'src/hello.ts' });
    expect(refs[0].abs).toBe(path.resolve(tmpDir, 'src/hello.ts'));
    expect(refs[0].content).toBe('export const hello = 1;\n');
    expect(refs[0].error).toBeUndefined();
  });

  it('records missing files without throwing', () => {
    const refs = parseFileRefs('missing @nope.txt');

    expect(refs).toHaveLength(1);
    expect(refs[0].rel).toBe('nope.txt');
    expect(refs[0].content).toBeUndefined();
    expect(refs[0].error).toBeTruthy();
  });

  it('marks too-large files and includes a capped preview', () => {
    const rel = 'large.txt';
    fs.writeFileSync(path.join(tmpDir, rel), 'a'.repeat(MAX_BYTES + 1));

    const refs = parseFileRefs(`summarize @${rel}`);

    expect(refs).toHaveLength(1);
    expect(refs[0].error).toContain('file too large');
    expect(refs[0].content).toHaveLength(MAX_BYTES);
  });
});

describe('renderFileRefBlock', () => {
  it('renders file contents, languages, errors, and notes', () => {
    const block = renderFileRefBlock([
      {
        raw: '@src/hello.ts',
        rel: 'src/hello.ts',
        abs: path.join(tmpDir, 'src', 'hello.ts'),
        content: 'export const hello = 1;',
      },
      {
        raw: '@missing.txt',
        rel: 'missing.txt',
        abs: path.join(tmpDir, 'missing.txt'),
        error: 'ENOENT',
      },
      {
        raw: '@large.md',
        rel: 'large.md',
        abs: path.join(tmpDir, 'large.md'),
        content: '# large',
        error: 'file too large',
      },
    ]);

    expect(block).toContain('### Referenced files');
    expect(block).toContain('#### src/hello.ts');
    expect(block).toContain('```ts\nexport const hello = 1;\n```');
    expect(block).toContain('#### missing.txt');
    expect(block).toContain('_[error: ENOENT]_');
    expect(block).toContain('#### large.md');
    expect(block).toContain('```md\n# large\n```');
    expect(block).toContain('_[note: file too large]_');
  });

  it('returns null for an empty ref list', () => {
    expect(renderFileRefBlock([])).toBeNull();
  });
});
