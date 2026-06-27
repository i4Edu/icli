import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { searchSymbols } from '../../src/tools/search-symbols.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-search-symbols-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('searchSymbols', () => {
  it('finds TypeScript symbols and filters by kind', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'export async function buildWidget(input: string): Promise<string> {',
        "  return input;",
        '}',
        'export class WidgetBuilder {}',
        'export interface WidgetConfig {',
        '  name: string;',
        '}',
        'export type WidgetMode = "light" | "dark";',
        'export const widgetCount = 1;',
      ].join('\n'),
    );

    const matches = JSON.parse(await searchSymbols({ query: 'Widget', type: 'all' })) as Array<{
      name: string;
      type: string;
      file: string;
      line: number;
      signature: string;
    }>;

    expect(matches).toEqual([
      {
        name: 'buildWidget',
        type: 'function',
        file: path.join('src', 'app.ts'),
        line: 1,
        signature: 'export async function buildWidget(input: string): Promise<string> {',
      },
      {
        name: 'WidgetBuilder',
        type: 'class',
        file: path.join('src', 'app.ts'),
        line: 4,
        signature: 'export class WidgetBuilder {}',
      },
      {
        name: 'WidgetConfig',
        type: 'interface',
        file: path.join('src', 'app.ts'),
        line: 5,
        signature: 'export interface WidgetConfig {',
      },
      {
        name: 'WidgetMode',
        type: 'type',
        file: path.join('src', 'app.ts'),
        line: 8,
        signature: 'export type WidgetMode = "light" | "dark";',
      },
    ]);

    const functionMatches = JSON.parse(
      await searchSymbols({ query: '^buildWidget$', type: 'function' }),
    ) as Array<{ name: string; type: string; file: string; line: number; signature: string }>;
    expect(functionMatches).toEqual([
      {
        name: 'buildWidget',
        type: 'function',
        file: path.join('src', 'app.ts'),
        line: 1,
        signature: 'export async function buildWidget(input: string): Promise<string> {',
      },
    ]);
  });

  it('respects filePattern and .gitignore', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored/\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.js'), 'export function visibleThing() {}\n');
    fs.writeFileSync(path.join(tmpDir, 'ignored', 'hidden.js'), 'export function hiddenThing() {}\n');

    const matches = JSON.parse(
      await searchSymbols({ query: 'Thing', filePattern: 'src/**/*.js', type: 'function' }),
    ) as Array<{ name: string; file: string; type: string; line: number; signature: string }>;

    expect(matches).toEqual([
      {
        name: 'visibleThing',
        file: path.join('src', 'main.js'),
        type: 'function',
        line: 1,
        signature: 'export function visibleThing() {}',
      },
    ]);
  });

  it('limits results to 50', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    const lines = Array.from({ length: 55 }, (_, index) => `export const item${index} = ${index};`);
    fs.writeFileSync(path.join(tmpDir, 'src', 'many.ts'), lines.join('\n'));

    const matches = JSON.parse(
      await searchSymbols({ query: '^item', type: 'variable' }),
    ) as Array<{ name: string; type: string; file: string; line: number; signature: string }>;

    expect(matches).toHaveLength(50);
    expect(matches[0]).toEqual({
      name: 'item0',
      type: 'variable',
      file: path.join('src', 'many.ts'),
      line: 1,
      signature: 'export const item0 = 0;',
    });
    expect(matches[49]).toEqual({
      name: 'item49',
      type: 'variable',
      file: path.join('src', 'many.ts'),
      line: 50,
      signature: 'export const item49 = 49;',
    });
  });
});
