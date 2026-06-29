import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { openBrowser, resolveBrowserCommand } from '../../src/util/browser.js';

describe('resolveBrowserCommand', () => {
  it('maps win32 to cmd/start', () => {
    expect(resolveBrowserCommand('win32', 'http://127.0.0.1:8787')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://127.0.0.1:8787'],
    });
  });

  it('maps darwin to open', () => {
    expect(resolveBrowserCommand('darwin', 'http://127.0.0.1:8787')).toEqual({
      command: 'open',
      args: ['http://127.0.0.1:8787'],
    });
  });

  it('maps linux to xdg-open', () => {
    expect(resolveBrowserCommand('linux', 'http://127.0.0.1:8787')).toEqual({
      command: 'xdg-open',
      args: ['http://127.0.0.1:8787'],
    });
  });
});

describe('openBrowser', () => {
  it('spawns a detached process and resolves', async () => {
    const unref = vi.fn();
    const once = vi.fn((_event: string, _handler: (...args: unknown[]) => void) => undefined);
    const child = { once, unref } as unknown as EventEmitter & { unref: () => void };
    const spawnImpl = vi.fn(() => child as any);

    await openBrowser('http://127.0.0.1:8787', spawnImpl as any);

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
