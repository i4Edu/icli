import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExplorePrompt, gatherProjectContext } from '../../src/commands/explore-cmd.js';

let baseDir: string;
let tmpDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.vitest-explore-cmd-tmp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'explore-'));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('gatherProjectContext', () => {
  it('builds a tree and respects basic ignore patterns', () => {
    writeFixture('.gitignore', 'ignored-dir\n*.log\n');
    writeFixture('package.json', '{"name":"fixture"}\n');
    writeFixture('README.md', '# Demo\n');
    writeFixture('src/index.ts', 'console.log("hi");\n');
    writeFixture('src/nested/deeper/value.ts', 'export const value = 1;\n');
    writeFixture('ignored-dir/secret.ts', 'export const secret = true;\n');
    writeFixture('notes.log', 'hidden\n');
    writeFixture('dist/out.js', 'ignored\n');
    writeFixture('node_modules/pkg/index.js', 'ignored\n');

    const tree = gatherProjectContext(tmpDir, 3);

    expect(tree).toContain('.');
    expect(tree).toContain('  src/');
    expect(tree).toContain('    index.ts');
    expect(tree).toContain('    nested/');
    expect(tree).toContain('      deeper/');
    expect(tree).not.toContain('ignored-dir/');
    expect(tree).not.toContain('notes.log');
    expect(tree).not.toContain('dist/');
    expect(tree).not.toContain('node_modules/');
  });
});

describe('buildExplorePrompt', () => {
  it('returns prompt and context with project metadata', () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        name: 'fixture-app',
        type: 'module',
        scripts: { test: 'vitest run', build: 'tsc -p .' },
        dependencies: { chalk: '^5.0.0' },
      }),
    );
    writeFixture('README.md', '# Fixture App\n\nUseful project summary.\n');
    writeFixture('src/index.ts', 'export const answer = 42;\n');

    const payload = buildExplorePrompt('Where is the main entry point?', tmpDir);

    expect(payload.prompt).toContain('lightweight codebase exploration agent');
    expect(payload.prompt).toContain('User question: Where is the main entry point?');
    expect(payload.context).toContain(`Workspace: ${tmpDir}`);
    expect(payload.context).toContain('File tree (depth <= 3, capped at 200 files):');
    expect(payload.context).toContain('package.json:');
    expect(payload.context).toContain('README snippet:');
    expect(payload.context).toContain('# Fixture App');
    expect(payload.context).toContain('Git status:');
  });
});
