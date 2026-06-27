import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from '../../src/config.js';

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

describe('clipboard-cmd', () => {
  const originalPlatform = process.platform;
  const originalCwd = config.cwd;
  const tmpRoot = path.join(process.cwd(), '.vitest-clipboard-tmp');

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    config.cwd = tmpRoot;
    execFileMock.mockReset();
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    setPlatform('linux');
  });

  afterEach(() => {
    config.cwd = originalCwd;
    setPlatform(originalPlatform);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('reads a Windows clipboard image and formats it for chat injection', async () => {
    setPlatform('win32');
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: any) => {
        callback(null, '__ICLI_IMAGE__E:\\AI\\icli\\.icopilot-clipboard\\clip.png\n', '');
      },
    );

    const { readClipboard, pasteToChat } = await import('../../src/commands/clipboard-cmd.js');
    const result = await readClipboard();

    expect(result).toEqual({
      type: 'image',
      content: 'E:\\AI\\icli\\.icopilot-clipboard\\clip.png',
    });
    await expect(pasteToChat()).resolves.toBe('"E:\\AI\\icli\\.icopilot-clipboard\\clip.png"');
  });

  it('reads macOS clipboard text via pbpaste', async () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 1 });
    execFileMock.mockImplementation(
      (command: string, _args: string[], _options: unknown, callback: any) => {
        if (command === 'pbpaste') {
          callback(null, 'clipboard prompt\n', '');
          return;
        }
        callback(new Error(`unexpected command ${command}`));
      },
    );

    const { readClipboard } = await import('../../src/commands/clipboard-cmd.js');

    await expect(readClipboard()).resolves.toEqual({
      type: 'text',
      content: 'clipboard prompt',
    });
  });

  it('formats context as markdown and copies it with xclip on Linux', async () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: 0 });
    const writes: string[] = [];
    spawnMock.mockImplementation((command: string, args: string[]) =>
      createClipboardWriter(command, args, writes),
    );
    const { copyContextToClipboard } = await import('../../src/commands/clipboard-cmd.js');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'System prompt summary\nMode: ask' },
      { role: 'user', content: 'Need help with clipboard support.' },
      { role: 'assistant', content: 'Sure — here is the current state.' },
    ];
    await copyContextToClipboard(messages);

    expect(spawnMock).toHaveBeenCalledWith(
      'xclip',
      ['-selection', 'clipboard'],
      expect.objectContaining({
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      }),
    );
    const written = writes.join('');
    expect(written).toContain('## System');
    expect(written).toContain('## User');
    expect(written).toContain('Need help with clipboard support.');
    expect(written).toContain('---');
  });
});

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value,
  });
}

function createClipboardWriter(command: string, args: string[], writes: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: (value?: string) => void };
    stderr: EventEmitter;
  };
  child.stderr = new EventEmitter();
  child.stdin = {
    end(value?: string) {
      writes.push(value ?? '');
      setImmediate(() => child.emit('close', 0));
    },
  };
  expect(command).toBe('xclip');
  expect(args).toEqual(['-selection', 'clipboard']);
  return child;
}
