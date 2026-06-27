import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refactorCommand } from '../../src/commands/refactor-cmd.js';

let tmpDir: string;
const tmpRoot = path.join(process.cwd(), '.vitest-refactor-cmd-tmp');

beforeEach(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('refactorCommand', () => {
  it('returns usage help when no args are provided', () => {
    const output = refactorCommand([], tmpDir);

    expect(output).toContain('Refactor command');
    expect(output).toContain('/refactor rename <old> <new> [path]');
    expect(output).toContain('/refactor extract <path> <lines>');
    expect(output).toContain('/refactor inline <path> <symbol>');
  });

  it('formats rename prompts correctly', () => {
    const filePath = path.join(tmpDir, 'src', 'example.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const oldName = 1;\nconsole.log(oldName);\n');

    const output = refactorCommand(['rename', 'oldName', 'newName', filePath], tmpDir);

    expect(output).toContain('Refactor intent: rename "oldName" to "newName"');
    expect(output).toContain('Rename the symbol "oldName" to "newName"');
    expect(output).toContain(filePath);
  });

  it('returns an error when extract targets a missing file', () => {
    const missingFile = path.join(tmpDir, 'missing.ts');

    const output = refactorCommand(['extract', missingFile, '12-20'], tmpDir);

    expect(output).toContain('target file not found');
    expect(output).toContain(missingFile);
  });

  it('formats inline prompts correctly', () => {
    const filePath = path.join(tmpDir, 'math.ts');
    fs.writeFileSync(filePath, 'const answer = 42;\nconsole.log(answer);\n');

    const output = refactorCommand(['inline', filePath, 'answer'], tmpDir);

    expect(output).toContain('Refactor intent: inline "answer" in math.ts');
    expect(output).toContain('Inline the symbol "answer"');
    expect(output).toContain(filePath);
  });
});
