import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DependencyResolver } from '../../src/context/dep-context.js';

let baseDir: string;
let projectDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  projectDir = fs.mkdtempSync(path.join(baseDir, 'dep-context-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('DependencyResolver', () => {
  it('resolves relative, dynamic, CommonJS, and tsconfig path imports while skipping node_modules', () => {
    writeProjectFiles(projectDir, {
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@lib/*': ['src/lib/*'],
            },
          },
        },
        null,
        2,
      ),
      'src/lib/value.ts': 'export const value = 1;\n',
      'src/shared/index.ts': 'export const shared = true;\n',
      'src/helper.ts': 'export const helper = true;\n',
      'src/dynamic.tsx': 'export const dynamicValue = true;\n',
      'src/common.jsx': 'module.exports = { common: true };\n',
      'src/entry.ts': [
        "import { value } from '@lib/value';",
        "import { shared } from './shared';",
        "import helper from './helper.js';",
        "const loaded = import('./dynamic');",
        "const common = require('./common');",
        "import express from 'express';",
        'export { value, shared, helper, loaded, common };',
        '',
      ].join('\n'),
    });

    const resolver = new DependencyResolver({ cwd: projectDir });
    const entryFile = path.join(projectDir, 'src', 'entry.ts');

    expect(resolver.resolveImports(entryFile)).toEqual([
      path.join(projectDir, 'src', 'lib', 'value.ts'),
      path.join(projectDir, 'src', 'shared', 'index.ts'),
      path.join(projectDir, 'src', 'helper.ts'),
      path.join(projectDir, 'src', 'dynamic.tsx'),
      path.join(projectDir, 'src', 'common.jsx'),
    ]);
  });

  it('follows imports recursively up to the requested depth', () => {
    writeProjectFiles(projectDir, {
      'src/root.ts': "import './level-one';\n",
      'src/level-one.ts': "import './level-two';\n",
      'src/level-two.ts': "import './level-three';\n",
      'src/level-three.ts': 'export const value = 3;\n',
    });

    const resolver = new DependencyResolver({ cwd: projectDir });
    const rootFile = path.join(projectDir, 'src', 'root.ts');

    expect(resolver.getRelatedFiles(rootFile)).toEqual([
      path.join(projectDir, 'src', 'level-one.ts'),
    ]);
    expect(resolver.getRelatedFiles(rootFile, 2)).toEqual([
      path.join(projectDir, 'src', 'level-one.ts'),
      path.join(projectDir, 'src', 'level-two.ts'),
    ]);
    expect(resolver.getRelatedFiles(rootFile, 3)).toEqual([
      path.join(projectDir, 'src', 'level-one.ts'),
      path.join(projectDir, 'src', 'level-two.ts'),
      path.join(projectDir, 'src', 'level-three.ts'),
    ]);
  });

  it('builds a full dependency graph for an entry file', () => {
    writeProjectFiles(projectDir, {
      'src/main.ts': ["import './feature';", "import './util';", ''].join('\n'),
      'src/feature.ts': "import './util';\n",
      'src/util.ts': 'export const util = true;\n',
    });

    const resolver = new DependencyResolver({ cwd: projectDir });
    const mainFile = path.join(projectDir, 'src', 'main.ts');
    const featureFile = path.join(projectDir, 'src', 'feature.ts');
    const utilFile = path.join(projectDir, 'src', 'util.ts');
    const graph = resolver.buildDependencyGraph(mainFile);

    expect([...graph.nodes.entries()]).toEqual([
      [mainFile, [featureFile, utilFile]],
      [featureFile, [utilFile]],
      [utilFile, []],
    ]);
  });
});

function writeProjectFiles(rootDir: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }
}
