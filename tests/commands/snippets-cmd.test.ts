import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snippetsCommand } from '../../src/commands/snippets-cmd.js';

let tmpDir: string;
let originalSnippetsDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-snippets-cmd-'));
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

describe('snippetsCommand', () => {
  it('lists snippets with first-line previews', async () => {
    await snippetsCommand(['save', 'hello', 'Hello', 'world']);
    await snippetsCommand(['save', 'multi', 'First\nSecond']);

    const explicitList = await snippetsCommand(['list']);
    expect(explicitList).toContain('Snippets');
    expect(explicitList).toContain('hello');
    expect(explicitList).toContain('Hello world');
    expect(explicitList).toContain('multi');
    expect(explicitList).toContain('First');

    const defaultList = await snippetsCommand([]);
    expect(defaultList).toBe(explicitList);
  });

  it('saves and shows snippets', async () => {
    const saved = await snippetsCommand(['save', 'ask', 'Explain', '{{topic}}']);
    expect(saved).toContain('saved snippet ask');

    const shown = await snippetsCommand(['show', 'ask']);
    expect(shown).toBe('Explain {{topic}}\n');
  });

  it('uses snippets with k=v variables', async () => {
    await snippetsCommand([
      'save',
      'ask',
      'Explain',
      '{{topic}}',
      'to',
      '{{audience}}',
      '{{unknown}}',
    ]);

    const used = await snippetsCommand(['use', 'ask', 'topic=TypeScript', 'audience=beginners']);
    expect(used).toBe('Explain TypeScript to beginners {{unknown}}\n');
  });

  it('deletes snippets', async () => {
    await snippetsCommand(['save', 'old', 'delete', 'me']);

    expect(await snippetsCommand(['delete', 'old'])).toContain('deleted snippet old');
    expect(await snippetsCommand(['show', 'old'])).toContain('snippet not found: old');
    expect(await snippetsCommand(['delete', 'old'])).toContain('snippet not found: old');
  });

  it('returns usage and validation messages', async () => {
    expect(await snippetsCommand(['save', 'missing-body'])).toContain('usage: /snippets save');
    expect(await snippetsCommand(['show'])).toContain('usage: /snippets show');
    expect(await snippetsCommand(['use'])).toContain('usage: /snippets use');
    expect(await snippetsCommand(['delete'])).toContain('usage: /snippets delete');
    expect(await snippetsCommand(['save', 'bad/name', 'body'])).toContain('Invalid snippet name');
    expect(await snippetsCommand(['wat'])).toContain('usage: /snippets');
  });
});
