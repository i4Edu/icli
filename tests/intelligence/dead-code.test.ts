import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeadCodeDetector } from '../../src/intelligence/dead-code.js';

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const target = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('DeadCodeDetector', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds unused exports and files while respecting roots, tests, and .gitignore', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-dead-code-'));
    tempDirs.push(rootDir);

    writeFile(rootDir, '.gitignore', 'src/ignored.ts\n');
    writeFile(rootDir, 'bin/cli.ts', `console.log('cli');\n`);
    writeFile(
      rootDir,
      'src/index.ts',
      [
        `export const publicApi = 'ready';`,
        `import './consumer.js';`,
        `import './relay-consumer.js';`,
        `import './bootstrap.js';`,
        '',
      ].join('\n'),
    );
    writeFile(rootDir, 'src/used.ts', `export function used(): string {\n  return 'used';\n}\n`);
    writeFile(
      rootDir,
      'src/consumer.ts',
      `import { used } from './used.js';\nvoid used();\n`,
    );
    writeFile(rootDir, 'src/bootstrap.ts', `export const boot = true;\n`);
    writeFile(
      rootDir,
      'src/dead.ts',
      `export function deadFn(): string {\n  return 'dead';\n}\nexport const deadValue = 1;\n`,
    );
    writeFile(rootDir, 'src/reexport.ts', `export { relayed } from './relayed.js';\n`);
    writeFile(
      rootDir,
      'src/relay-consumer.ts',
      `import { relayed } from './reexport.js';\nvoid relayed;\n`,
    );
    writeFile(rootDir, 'src/relayed.ts', `export const relayed = 'ok';\n`);
    writeFile(rootDir, 'src/orphan.ts', `export const orphan = 'unused';\n`);
    writeFile(rootDir, 'src/ignored.ts', `export const ignored = true;\n`);
    writeFile(rootDir, 'src/helper.test.ts', `export const helper = true;\n`);

    const detector = new DeadCodeDetector();
    const report = detector.scan(rootDir);

    expect(report.unusedFiles).toEqual(['src/dead.ts', 'src/orphan.ts']);
    expect(report.unusedExports).toEqual([
      { name: 'boot', file: 'src/bootstrap.ts', line: 1, kind: 'const' },
      { name: 'deadFn', file: 'src/dead.ts', line: 1, kind: 'function' },
      { name: 'deadValue', file: 'src/dead.ts', line: 4, kind: 'const' },
      { name: 'orphan', file: 'src/orphan.ts', line: 1, kind: 'const' },
    ]);
    expect(report.stats).toEqual({
      total: 18,
      unused: 6,
      percentage: 33.33,
    });

    expect(report.unusedExports.some((entry) => entry.name === 'publicApi')).toBe(false);
    expect(report.unusedExports.some((entry) => entry.name === 'relayed')).toBe(false);
    expect(report.unusedFiles).not.toContain('bin/cli.ts');
    expect(report.unusedFiles).not.toContain('src/helper.test.ts');
    expect(report.unusedFiles).not.toContain('src/ignored.ts');

    expect(detector.getUnusedFiles(rootDir)).toEqual(['src/dead.ts', 'src/orphan.ts']);
    expect(detector.getUnusedExports(rootDir).map((entry) => entry.name)).toEqual([
      'boot',
      'deadFn',
      'deadValue',
      'orphan',
    ]);
  });

  it('honors explicit entry points when no default roots exist', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-dead-code-entry-'));
    tempDirs.push(rootDir);

    writeFile(rootDir, 'src/main.ts', `import { helper } from './helper.js';\nvoid helper();\n`);
    writeFile(rootDir, 'src/helper.ts', `export function helper(): string {\n  return 'ok';\n}\n`);
    writeFile(rootDir, 'src/lonely.ts', `export const lonely = true;\n`);

    const detector = new DeadCodeDetector();
    const report = detector.scan(rootDir, { entryPoints: ['src/main.ts'] });

    expect(report.unusedFiles).toEqual(['src/lonely.ts']);
    expect(report.unusedExports).toEqual([
      { name: 'lonely', file: 'src/lonely.ts', line: 1, kind: 'const' },
    ]);
  });
});
