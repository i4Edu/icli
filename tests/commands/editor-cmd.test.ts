import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

describe('openEditor', () => {
  let tmpRoot: string;
  let tmpDir: string;
  let originalCwd: string;
  let originalVisual: string | undefined;
  let originalEditor: string | undefined;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-editor-cmd-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    originalCwd = config.cwd;
    config.cwd = tmpDir;
    originalVisual = process.env.VISUAL;
    originalEditor = process.env.EDITOR;
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    config.cwd = originalCwd;
    if (originalVisual === undefined) {
      delete process.env.VISUAL;
    } else {
      process.env.VISUAL = originalVisual;
    }
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('prefers VISUAL over EDITOR and falls back when unset', async () => {
    const { openEditor } = await import('../../src/commands/editor-cmd.js');

    spawnSyncMock.mockImplementation((command: string) => {
      const match = command.match(/"(.+\.md)"/);
      if (match) fs.writeFileSync(match[1], 'from editor\n', 'utf8');
      return { status: 0 };
    });

    process.env.VISUAL = 'nano';
    process.env.EDITOR = 'vim';
    await openEditor();
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      expect.stringContaining('nano '),
      expect.objectContaining({ cwd: tmpDir, shell: true, stdio: 'inherit' }),
    );

    delete process.env.VISUAL;
    await openEditor();
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      expect.stringContaining('vim '),
      expect.objectContaining({ cwd: tmpDir, shell: true, stdio: 'inherit' }),
    );

    delete process.env.EDITOR;
    await openEditor();
    const fallback = process.platform === 'win32' ? 'code --wait ' : 'vim ';
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      expect.stringContaining(fallback),
      expect.objectContaining({ cwd: tmpDir, shell: true, stdio: 'inherit' }),
    );
  });

  it('creates an md temp file and removes it after the editor exits', async () => {
    const { openEditor } = await import('../../src/commands/editor-cmd.js');
    let tempFilePath = '';

    spawnSyncMock.mockImplementation((command: string) => {
      const match = command.match(/"(.+\.md)"/);
      expect(match?.[1]).toBeTruthy();
      tempFilePath = match![1];
      expect(fs.existsSync(tempFilePath)).toBe(true);
      fs.writeFileSync(tempFilePath, 'hello from editor\n', 'utf8');
      return { status: 0 };
    });

    await expect(openEditor()).resolves.toBe('hello from editor');
    expect(path.extname(tempFilePath)).toBe('.md');
    expect(fs.existsSync(tempFilePath)).toBe(false);
  });

  it('returns null when the editor leaves the file empty', async () => {
    const { openEditor } = await import('../../src/commands/editor-cmd.js');

    spawnSyncMock.mockImplementation(() => ({ status: 0 }));

    await expect(openEditor()).resolves.toBeNull();
  });

  it('returns trimmed content after the editor closes', async () => {
    const { openEditor } = await import('../../src/commands/editor-cmd.js');

    spawnSyncMock.mockImplementation((command: string) => {
      const match = command.match(/"(.+\.md)"/);
      expect(match?.[1]).toBeTruthy();
      fs.writeFileSync(match![1], '\n  first line\nsecond line  \n', 'utf8');
      return { status: 0 };
    });

    await expect(openEditor()).resolves.toBe('first line\nsecond line');
  });
});
