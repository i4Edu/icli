import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { listDirectory } from '../../src/tools/list-directory.js';
import { dispatchTool, TOOL_SCHEMAS } from '../../src/tools/registry.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'list-directory-test-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listDirectory', () => {
  it('lists immediate entries with metadata', async () => {
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    fs.writeFileSync(path.join(tmpDir, 'alpha.txt'), 'hello', 'utf8');

    const result = await listDirectory({ path: '.' });

    expect(result).toContain('./');
    expect(result).toContain('nested/ [dir, modified ');
    expect(result).toContain('alpha.txt [file, 5 B, modified ');
  });

  it('respects .gitignore and maxDepth when recursive', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored/\n*.log\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'visible', 'deeper'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'visible', 'child.txt'), 'child', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, 'visible', 'deeper', 'grandchild.txt'),
      'grandchild',
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, 'ignored', 'secret.txt'), 'secret', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'debug.log'), 'ignore me', 'utf8');

    const result = await listDirectory({ path: '.', recursive: true, maxDepth: 2 });

    expect(result).toContain('visible/ [dir, modified ');
    expect(result).toContain('child.txt [file, 5 B, modified ');
    expect(result).not.toContain('grandchild.txt');
    expect(result).not.toContain('ignored/');
    expect(result).not.toContain('debug.log');
  });

  it('filters by glob pattern and is registered in the tool registry', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');

    const result = await dispatchTool('list_directory', {
      path: '.',
      recursive: true,
      pattern: '*.ts',
    });

    expect(TOOL_SCHEMAS.some((schema) => schema.function.name === 'list_directory')).toBe(true);
    expect(result).toContain('main.ts [file, 20 B, modified ');
    expect(result).not.toContain('main.js');
  });

  it('truncates output after 200 entries with a note', async () => {
    for (let index = 0; index < 205; index += 1) {
      fs.writeFileSync(path.join(tmpDir, `file-${index}.txt`), `${index}`, 'utf8');
    }

    const result = await listDirectory({ path: '.' });
    const fileLines = result
      .split('\n')
      .filter((line) => line.includes('file-') && line.includes('[file,'));

    expect(fileLines).toHaveLength(200);
    expect(result).toContain('showing first 200 of 205');
  });
});
