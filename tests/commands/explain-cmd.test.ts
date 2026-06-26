import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExplain } from '../../src/commands/explain-cmd.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-explain-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildExplain', () => {
  it('returns missing payload for a missing path', () => {
    const payload = buildExplain('missing.ts', tmpDir);

    expect(payload.kind).toBe('missing');
    expect(payload.preview).toBe('');
    expect(payload.prompt).toContain("the path doesn't exist");
  });

  it('returns file payload with file content preview', () => {
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const hello = "world";\n');

    const payload = buildExplain('hello.ts', tmpDir);

    expect(payload.kind).toBe('file');
    expect(payload.preview).toContain('export const hello');
    expect(payload.prompt).toContain('key exports');
  });

  it('returns dir payload with entry names in preview', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {};\n');

    const payload = buildExplain('src', tmpDir);

    expect(payload.kind).toBe('dir');
    expect(payload.preview).toContain('index.ts');
    expect(payload.prompt).toContain('architectural summary');
  });
});
