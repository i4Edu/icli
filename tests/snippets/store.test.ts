import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteSnippet,
  expandSnippet,
  listSnippets,
  readSnippet,
  saveSnippet,
  snippetsDir,
} from '../../src/snippets/store.js';

let tmpDir: string;
let originalSnippetsDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-snippets-'));
  originalSnippetsDir = process.env.ICOPILOT_SNIPPETS_DIR;
  process.env.ICOPILOT_SNIPPETS_DIR = tmpDir;
});

afterEach(() => {
  if (originalSnippetsDir === undefined) {
    delete process.env.ICOPILOT_SNIPPETS_DIR;
  } else {
    process.env.ICOPILOT_SNIPPETS_DIR = originalSnippetsDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('snippet store', () => {
  it('round-trips save, list, read, and delete', () => {
    expect(snippetsDir()).toBe(tmpDir);

    const saved = saveSnippet('greeting', 'Hello {{name}}\nSecond line');
    expect(saved.name).toBe('greeting');
    expect(saved.body).toBe('Hello {{name}}\nSecond line');
    expect(saved.updatedAt).toEqual(expect.any(String));

    expect(fs.readFileSync(path.join(tmpDir, 'greeting.md'), 'utf8')).toBe('Hello {{name}}\nSecond line');
    expect(readSnippet('greeting')).toMatchObject({ name: 'greeting', body: 'Hello {{name}}\nSecond line' });
    expect(listSnippets().map((snippet) => snippet.name)).toEqual(['greeting']);

    expect(deleteSnippet('greeting')).toBe(true);
    expect(readSnippet('greeting')).toBeNull();
    expect(deleteSnippet('greeting')).toBe(false);
    expect(listSnippets()).toEqual([]);
  });

  it('validates snippet names', () => {
    expect(() => saveSnippet('ok_1-name', 'body')).not.toThrow();
    expect(() => saveSnippet('-bad', 'body')).toThrow(/Invalid snippet name/);
    expect(() => readSnippet('../bad')).toThrow(/Invalid snippet name/);
    expect(() => deleteSnippet('bad name')).toThrow(/Invalid snippet name/);
    expect(() => saveSnippet('a'.repeat(65), 'body')).toThrow(/Invalid snippet name/);
  });

  it('expands known placeholders and leaves unknown placeholders intact', () => {
    expect(expandSnippet('Hello {{name}}, use {{tool}} and {{missing}}.', { name: 'Ada', tool: 'Vitest' })).toBe(
      'Hello Ada, use Vitest and {{missing}}.',
    );
  });
});
