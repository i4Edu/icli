import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeServer,
  IDEBridge,
  type BridgeMessage,
  type BridgeTransport,
} from '../../src/bridge/ide-bridge.js';

describe('IDE bridge', () => {
  let server: BridgeServer | null = null;
  let bridge: IDEBridge | null = null;

  afterEach(async () => {
    await bridge?.disconnect();
    await server?.stop();
    bridge = null;
    server = null;
  });

  it('uses an injected transport to send and receive messages', async () => {
    const listeners = {
      message: new Set<(data: string) => void>(),
      close: new Set<() => void>(),
    };
    let open = true;
    const send = vi.fn();

    const transport: BridgeTransport = {
      send,
      close: vi.fn(() => {
        open = false;
        for (const handler of listeners.close) handler();
      }),
      onMessage(handler) {
        listeners.message.add(handler);
        return () => listeners.message.delete(handler);
      },
      onClose(handler) {
        listeners.close.add(handler);
        return () => listeners.close.delete(handler);
      },
      isOpen() {
        return open;
      },
    };

    bridge = new IDEBridge({
      createTransport: vi.fn(async () => transport),
    });
    const received: BridgeMessage[] = [];
    bridge.onMessage((message) => {
      received.push(message);
    });

    await bridge.connect(9123);
    bridge.send({ type: 'status', payload: { ok: true } });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'status', payload: { ok: true } }));

    for (const handler of listeners.message) {
      handler(JSON.stringify({ type: 'navigate', payload: { file: 'src/index.ts', line: 3 } }));
    }

    expect(received).toEqual([{ type: 'navigate', payload: { file: 'src/index.ts', line: 3 } }]);
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.getPort()).toBe(9123);

    await bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.getPort()).toBeNull();
  });

  it('connects to a bridge server and exchanges websocket messages', async () => {
    server = new BridgeServer({ heartbeatMs: 50 });
    const port = await server.start(0);
    bridge = new IDEBridge();

    const serverMessages: BridgeMessage[] = [];
    const clientMessages: BridgeMessage[] = [];
    server.onMessage((message) => {
      serverMessages.push(message);
    });
    bridge.onMessage((message) => {
      clientMessages.push(message);
    });

    await bridge.connect(port);
    expect(bridge.isConnected()).toBe(true);
    expect(server.getConnectionCount()).toBe(1);

    bridge.send({ type: 'status', payload: { source: 'client' } });
    await waitFor(() => serverMessages.length === 1);
    expect(serverMessages[0]).toEqual({ type: 'status', payload: { source: 'client' } });

    server.broadcast({ type: 'openFile', payload: { path: 'src/commands/slash.ts' } });
    await waitFor(() => clientMessages.length === 1);
    expect(clientMessages[0]).toEqual({
      type: 'openFile',
      payload: { path: 'src/commands/slash.ts' },
    });

    await bridge.disconnect();
    await waitFor(() => server?.getConnectionCount() === 0);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for bridge condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
