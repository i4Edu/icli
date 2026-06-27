import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSummary } from '../../src/commands/summary-cmd.js';

let baseDir: string;
let tmpDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.vitest-summary-cmd-tmp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'summary-'));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('buildSummary', () => {
  it('extracts projectName from package.json', () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        name: 'fixture-app',
        scripts: { test: 'vitest run' },
        dependencies: { react: '^19.0.0' },
      }),
    );
    writeFixture('tsconfig.json', '{}');
    fs.mkdirSync(path.join(tmpDir, 'src'));

    const payload = buildSummary(tmpDir);

    expect(payload.projectName).toBe('fixture-app');
    expect(payload.structure).toContain('Detected stack:');
    expect(payload.structure).toContain('- Node.js');
    expect(payload.structure).toContain('- TypeScript');
    expect(payload.structure).toContain('- React');
    expect(payload.structure).toContain('- src/');
  });

  it('falls back to the directory name when package.json is missing', () => {
    writeFixture('pyproject.toml', '[project]\nname = "demo"\n');

    const payload = buildSummary(tmpDir);

    expect(payload.projectName).toBe(path.basename(tmpDir));
    expect(payload.structure).toContain('- Python');
    expect(payload.structure).toContain(`Workspace: ${tmpDir}`);
  });

  it('filters ignored directories from top-level entries', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.mkdirSync(path.join(tmpDir, 'dist'));

    const payload = buildSummary(tmpDir);

    expect(payload.structure).toContain('- src/');
    expect(payload.structure).not.toContain('node_modules/');
    expect(payload.structure).not.toContain('.git/');
    expect(payload.structure).not.toContain('dist/');
  });

  it('builds a prompt with project context', () => {
    writeFixture(
      'package.json',
      JSON.stringify({
        name: 'context-app',
        scripts: { build: 'tsc -p .' },
        dependencies: { express: '^4.0.0' },
      }),
    );
    writeFixture('src/index.ts', 'console.log("hello");\n');

    const payload = buildSummary(tmpDir);

    expect(payload.prompt).toContain('Summarize the architecture of the project "context-app"');
    expect(payload.prompt).toContain('Top-level entries:');
    expect(payload.prompt).toContain('- src/');
    expect(payload.prompt).toContain('- build: tsc -p .');
    expect(payload.prompt).toContain('- Express');
  });
});
