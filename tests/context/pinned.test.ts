import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PinnedContext } from '../../src/context/pinned.js';
import { countTokensSync } from '../../src/util/tokens.js';

let tmpDir: string;

beforeEach(() => {
  const baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'pinned-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PinnedContext', () => {
  it('adds a real file and estimates tokens', () => {
    const ctx = new PinnedContext();
    const filePath = path.join(tmpDir, 'notes.txt');
    const content = 'hello pinned context\nsecond line\n';
    fs.writeFileSync(filePath, content);

    const pinned = ctx.add('notes.txt', tmpDir);

    expect(pinned).toEqual({
      path: path.resolve(tmpDir, 'notes.txt'),
      addedAt: expect.any(String),
      tokens: countTokensSync(content),
    });
    expect(ctx.list()).toEqual([pinned]);
    expect(ctx.totalTokens()).toBe(countTokensSync(content));
  });

  it('returns null when adding a non-existent file', () => {
    const ctx = new PinnedContext();

    expect(ctx.add('missing.txt', tmpDir)).toBeNull();
    expect(ctx.list()).toEqual([]);
  });

  it('removes files, lists files, and clears all files', () => {
    const ctx = new PinnedContext();
    fs.writeFileSync(path.join(tmpDir, 'one.ts'), 'export const one = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'two.ts'), 'export const two = 2;\n');

    const first = ctx.add('one.ts', tmpDir);
    const second = ctx.add('two.ts', tmpDir);

    expect(ctx.list()).toEqual([first, second]);
    expect(ctx.remove(path.resolve(tmpDir, 'one.ts'))).toBe(true);
    expect(ctx.list()).toEqual([second]);
    expect(ctx.remove(path.resolve(tmpDir, 'one.ts'))).toBe(false);
    expect(ctx.clear()).toBe(1);
    expect(ctx.list()).toEqual([]);
  });

  it('renders pinned file contents as a context block', () => {
    const ctx = new PinnedContext();
    const filePath = path.join(tmpDir, 'snippet.ts');
    fs.writeFileSync(filePath, 'export const value = 42;\n');
    ctx.add('snippet.ts', tmpDir);

    const rendered = ctx.render();

    expect(rendered).toContain('### Pinned context files');
    expect(rendered).toContain(`#### ${filePath}`);
    expect(rendered).toContain('```ts');
    expect(rendered).toContain('export const value = 42;');
  });

  it('round-trips through serialization', () => {
    const ctx = new PinnedContext();
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"name":"demo"}\n');
    ctx.add('config.json', tmpDir);

    const restored = PinnedContext.fromJSON(ctx.toJSON());

    expect(restored.list()).toEqual(ctx.list());
    expect(restored.totalTokens()).toBe(ctx.totalTokens());
  });
});
