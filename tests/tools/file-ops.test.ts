import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '@inquirer/prompts';
import { config } from '../../src/config.js';
import { proposeWrite } from '../../src/tools/file-ops.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));

let tmpDir: string;
let originalCwd: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-file-ops-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.mocked(confirm).mockReset();
});

afterEach(() => {
  stdoutSpy.mockRestore();
  config.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('proposeWrite', () => {
  it('writes the file when confirmation succeeds', async () => {
    vi.mocked(confirm).mockResolvedValue(true);

    const result = await proposeWrite('nested/example.txt', 'hello\n');

    expect(result.wrote).toBe(true);
    expect(result.bytes).toBe(Buffer.byteLength('hello\n'));
    expect(fs.readFileSync(path.join(tmpDir, 'nested', 'example.txt'), 'utf8')).toBe('hello\n');
    expect(confirm).toHaveBeenCalledWith({ message: 'Create this new file?', default: false });
  });

  it('skips writing when confirmation is denied', async () => {
    fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'old\n');
    vi.mocked(confirm).mockResolvedValue(false);

    const result = await proposeWrite('existing.txt', 'new\n');

    expect(result).toMatchObject({ wrote: false, bytes: 0 });
    expect(fs.readFileSync(path.join(tmpDir, 'existing.txt'), 'utf8')).toBe('old\n');
    expect(confirm).toHaveBeenCalledWith({ message: 'Apply this patch?', default: false });
  });
});
