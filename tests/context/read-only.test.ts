import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '@inquirer/prompts';
import { config } from '../../src/config.js';
import {
  addReadOnly,
  clearReadOnly,
  getReadOnlyContext,
  getReadOnlyFiles,
  isReadOnly,
  removeReadOnly,
} from '../../src/context/read-only.js';
import { proposeWrite } from '../../src/tools/file-ops.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));

let tmpDir: string;
let originalCwd: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

describe('read-only context', () => {
  beforeEach(() => {
    const baseDir = path.join(process.cwd(), '.test-temp');
    fs.mkdirSync(baseDir, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(baseDir, 'read-only-'));
    originalCwd = config.cwd;
    config.cwd = tmpDir;
    clearReadOnly();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(confirm).mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    clearReadOnly();
    config.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds, lists, checks, and removes read-only files', () => {
    const filePath = path.join(tmpDir, 'notes.ts');
    fs.writeFileSync(filePath, 'export const note = true;\n', 'utf8');

    const added = addReadOnly('notes.ts');

    expect(added).toBe(filePath);
    expect(isReadOnly('notes.ts')).toBe(true);
    expect(getReadOnlyFiles()).toEqual([filePath]);
    expect(removeReadOnly('notes.ts')).toBe(true);
    expect(isReadOnly('notes.ts')).toBe(false);
    expect(getReadOnlyFiles()).toEqual([]);
  });

  it('renders read-only files for prompt injection', () => {
    const filePath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(filePath, '{\"name\":\"demo\"}\n', 'utf8');
    addReadOnly('config.json');

    const rendered = getReadOnlyContext();

    expect(rendered).toContain('### Read-only context files');
    expect(rendered).toContain('Do not modify them');
    expect(rendered).toContain(filePath);
    expect(rendered).toContain('```json');
    expect(rendered).toContain('{"name":"demo"}');
  });

  it('refuses writes to read-only files', async () => {
    const filePath = path.join(tmpDir, 'locked.txt');
    fs.writeFileSync(filePath, 'before\n', 'utf8');
    addReadOnly('locked.txt');
    vi.mocked(confirm).mockResolvedValue(true);

    const result = await proposeWrite('locked.txt', 'after\n');

    expect(result.wrote).toBe(false);
    expect(result.error).toBe('read-only file');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('before\n');
  });
});
