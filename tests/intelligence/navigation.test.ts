import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findImplementations, findReferences, goToDefinition } from '../../src/intelligence/navigation.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.vitest-navigation-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored/\n');
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'types.ts'),
    ['export interface Worker {}', 'export class BaseWorker {}', 'export const widget = 1;'].join(
      '\n',
    ),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'usage.ts'),
    [
      "import { BaseWorker, Worker, widget } from './types.js';",
      'class WorkerImpl implements Worker {}',
      'class FancyWorker extends BaseWorker {}',
      'const total = widget + widget;',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(tmpDir, 'src', 'assign.ts'), 'service = () => widget;\n');
  fs.writeFileSync(path.join(tmpDir, 'ignored', 'hidden.ts'), 'export const widget = 99;\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('navigation', () => {
  it('finds exported and assignment definitions', () => {
    expect(goToDefinition('Worker', tmpDir)).toEqual({
      file: path.join('src', 'types.ts'),
      line: 1,
      column: 18,
      context: 'export interface Worker {}',
    });

    expect(goToDefinition('service', tmpDir)).toEqual({
      file: path.join('src', 'assign.ts'),
      line: 1,
      column: 1,
      context: 'service = () => widget;',
    });
  });

  it('finds references and excludes definitions in ignored paths', () => {
    expect(findReferences('widget', tmpDir)).toEqual([
      {
        file: path.join('src', 'assign.ts'),
        line: 1,
        column: 17,
        context: 'service = () => widget;',
      },
      {
        file: path.join('src', 'usage.ts'),
        line: 1,
        column: 30,
        context: "import { BaseWorker, Worker, widget } from './types.js';",
      },
      {
        file: path.join('src', 'usage.ts'),
        line: 4,
        column: 15,
        context: 'const total = widget + widget;',
      },
      {
        file: path.join('src', 'usage.ts'),
        line: 4,
        column: 24,
        context: 'const total = widget + widget;',
      },
    ]);
  });

  it('finds classes implementing or extending a symbol', () => {
    expect(findImplementations('Worker', tmpDir)).toEqual([
      {
        file: path.join('src', 'usage.ts'),
        line: 2,
        column: 29,
        context: 'class WorkerImpl implements Worker {}',
      },
    ]);

    expect(findImplementations('BaseWorker', tmpDir)).toEqual([
      {
        file: path.join('src', 'usage.ts'),
        line: 3,
        column: 27,
        context: 'class FancyWorker extends BaseWorker {}',
      },
    ]);
  });
});
