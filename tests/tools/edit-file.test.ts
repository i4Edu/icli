import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { select } from '@inquirer/prompts';
import { config } from '../../src/config.js';
import { toolMemory } from '../../src/tools/memory.js';
import { editFileTool } from '../../src/tools/edit-file.js';

vi.mock('@inquirer/prompts', () => ({ select: vi.fn(), confirm: vi.fn() }));

let tmpDir: string;
let originalCwd: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-edit-file-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  toolMemory.allowWritePath.clear();
  vi.mocked(select).mockReset();
});

afterEach(() => {
  stdoutSpy.mockRestore();
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('editFileTool', () => {
  it('returns an error when the file does not exist', async () => {
    const result = JSON.parse(
      await editFileTool({
        path: 'missing.txt',
        startLine: 1,
        endLine: 1,
        newContent: 'hello',
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('file not found');
  });

  it('returns an error for invalid line numbers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'example.txt'), 'a\nb\nc\n', 'utf8');

    const startTooSmall = JSON.parse(
      await editFileTool({
        path: 'example.txt',
        startLine: 0,
        endLine: 1,
        newContent: 'x',
      }),
    );
    const rangeBackwards = JSON.parse(
      await editFileTool({
        path: 'example.txt',
        startLine: 3,
        endLine: 2,
        newContent: 'x',
      }),
    );
    const outOfBounds = JSON.parse(
      await editFileTool({
        path: 'example.txt',
        startLine: 4,
        endLine: 5,
        newContent: 'x',
      }),
    );

    expect(startTooSmall.ok).toBe(false);
    expect(startTooSmall.error).toContain('startLine');
    expect(rangeBackwards.ok).toBe(false);
    expect(rangeBackwards.error).toContain('endLine');
    expect(outOfBounds.ok).toBe(false);
    expect(outOfBounds.error).toContain('out of bounds');
  });

  it('replaces the requested lines when approved', async () => {
    fs.writeFileSync(path.join(tmpDir, 'example.txt'), 'alpha\nbeta\ngamma\ndelta\n', 'utf8');
    vi.mocked(select).mockResolvedValue(true as never);

    const result = JSON.parse(
      await editFileTool({
        path: 'example.txt',
        startLine: 2,
        endLine: 3,
        newContent: 'BETA\nGAMMA',
      }),
    );

    expect(result).toEqual({ ok: true, linesReplaced: 2, newLineCount: 2 });
    expect(fs.readFileSync(path.join(tmpDir, 'example.txt'), 'utf8')).toBe(
      'alpha\nBETA\nGAMMA\ndelta\n',
    );
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Apply this patch?' }),
    );
  });
});
