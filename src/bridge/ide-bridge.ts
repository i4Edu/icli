import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 7891;

export interface BridgeMessage {
  type: 'openFile' | 'editFile' | 'showDiff' | 'navigate' | 'diagnostic' | 'status';
  payload: unknown;
}

export type BridgeMessageHandler = (message: BridgeMessage) => void;

export interface BridgeTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: string) => void): () => void;
  onClose(handler: () => void): () => void;
  isOpen(): boolean;
}

export interface IDEBridgeOptions {
  createTransport?: (port: number) => Promise<BridgeTransport>;
}

export interface BridgeServerOptions {
  heartbeatMs?: number;
}

export class IDEBridge {
  private readonly handlers = new Set<BridgeMessageHandler>();

  private readonly createTransport: (port: number) => Promise<BridgeTransport>;

  private transport: BridgeTransport | null = null;

  private cleanupTransport: Array<() => void> = [];

  private port: number | null = null;

  constructor(options: IDEBridgeOptions = {}) {
    this.createTransport = options.createTransport ?? createClientTransport;
  }

  async connect(port = DEFAULT_BRIDGE_PORT): Promise<void> {
    if (this.transport && this.transport.isOpen() && this.port === port) return;
    await this.disconnect();

    const transport = await this.createTransport(port);
    this.transport = transport;
    this.port = port;
    this.cleanupTransport = [
      transport.onMessage((raw) => {
        const message = parseBridgeMessage(raw);
        if (!message) return;
        for (const handler of this.handlers) handler(message);
      }),
      transport.onClose(() => {
        this.transport = null;
      }),
    ];
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.port = null;

    for (const cleanup of this.cleanupTransport.splice(0)) cleanup();
    if (!transport) return;

    transport.close();
  }

  send(message: BridgeMessage): void {
    if (!this.transport || !this.transport.isOpen()) {
      throw new Error('IDE bridge is not connected.');
    }

    this.transport.send(JSON.stringify(message));
  }

  onMessage(handler: BridgeMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return Boolean(this.transport?.isOpen());
  }

  getPort(): number | null {
    return this.port;
  }
}

export class BridgeServer {
  private readonly handlers = new Set<(message: BridgeMessage) => void>();

  private readonly heartbeatMs: number;

  private server: HttpServer | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly connections = new Set<RawWebSocketConnection>();

  private port: number | null = null;

  constructor(options: BridgeServerOptions = {}) {
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
  }

  async start(port = DEFAULT_BRIDGE_PORT): Promise<number> {
    if (this.server && this.port === port) return this.port;
    if (this.server) await this.stop();

    const server = createServer((_request, response) => {
      response.statusCode = 426;
      response.setHeader('Connection', 'close');
      response.end('Upgrade Required');
    });

    server.on('upgrade', (request, socket, head) => {
      if (!isWebSocketUpgrade(request)) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string' || !key.trim()) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const accept = createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n',
        ].join('\r\n'),
      );

      const connection = new RawWebSocketConnection(socket as net.Socket, false, head);
      this.connections.add(connection);
      connection.onMessage((raw) => {
        const message = parseBridgeMessage(raw);
        if (!message) return;
        for (const handler of this.handlers) handler(message);
      });
      connection.onClose(() => {
        this.connections.delete(connection);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('error', onError);
        reject(error);
      };

      server.once('error', onError);
      server.listen(port, DEFAULT_HOST, () => {
        server.off('error', onError);
        resolve();
      });
    });

    this.server = server;
    this.port = (server.address() as AddressInfo | null)?.port ?? port;
    this.startHeartbeat();
    return this.port;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const connection of this.connections) {
      connection.close();
      connection.terminate();
    }
    this.connections.clear();

    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  broadcast(message: BridgeMessage): void {
    const payload = JSON.stringify(message);
    for (const connection of this.connections) {
      connection.sendText(payload);
    }
  }

  onMessage(handler: BridgeMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      for (const connection of this.connections) {
        if (!connection.beginHeartbeat()) {
          connection.terminate();
          this.connections.delete(connection);
          continue;
        }
        connection.sendPing();
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }
}

class RawWebSocketConnection extends EventEmitter {
  private buffer = Buffer.alloc(0);

  private open = true;

  private alive = true;

  private closeSent = false;

  constructor(
    private readonly socket: net.Socket,
    private readonly maskOutgoing: boolean,
    initialData?: Buffer,
  ) {
    super();
    socket.on('data', (chunk) => {
      this.alive = true;
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      this.drainBuffer();
    });
    socket.on('close', () => {
      this.handleClose();
    });
    socket.on('end', () => {
      this.handleClose();
    });
    socket.on('error', () => {
      this.handleClose();
    });

    if (initialData && initialData.length > 0) {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(initialData)]);
      this.drainBuffer();
    }
  }

  onMessage(handler: (data: string) => void): void {
    this.on('message', handler);
  }

  onClose(handler: () => void): void {
    this.on('close-connection', handler);
  }

  sendText(data: string): void {
    this.writeFrame(0x1, Buffer.from(data, 'utf8'));
  }

  sendPing(payload = Buffer.alloc(0)): void {
    this.writeFrame(0x9, payload);
  }

  sendPong(payload = Buffer.alloc(0)): void {
    this.writeFrame(0xa, payload);
  }

  beginHeartbeat(): boolean {
    const wasAlive = this.alive;
    this.alive = false;
    return wasAlive;
  }

  close(code = 1000, reason = ''): void {
    if (this.closeSent) return;

    const reasonBuffer = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.closeSent = true;
    this.writeFrame(0x8, payload);
  }

  terminate(): void {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
  }

  private handleClose(): void {
    if (!this.open) return;
    this.open = false;
    this.emit('close-connection');
  }

  private drainBuffer(): void {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return;
        const rawLength = this.buffer.readBigUInt64BE(offset);
        if (rawLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.terminate();
          return;
        }
        payloadLength = Number(rawLength);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      const frameLength = offset + maskLength + payloadLength;
      if (this.buffer.length < frameLength) return;

      let mask: Buffer | undefined;
      if (masked) {
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLength));
      this.buffer = this.buffer.subarray(frameLength);

      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
        continue;
      }

      if (opcode === 0x8) {
        if (!this.closeSent) {
          this.closeSent = true;
          this.writeFrame(0x8, payload);
        }
        this.socket.end();
        continue;
      }

      if (opcode === 0x9) {
        this.sendPong(payload);
        continue;
      }

      if (opcode === 0xa) {
        this.alive = true;
      }
    }
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (!this.open || this.socket.destroyed) return;

    const headerLength =
      2 +
      (payload.length < 126 ? 0 : payload.length < 65_536 ? 2 : 8) +
      (this.maskOutgoing ? 4 : 0);
    const frame = Buffer.allocUnsafe(headerLength + payload.length);
    let offset = 0;

    frame[offset] = 0x80 | (opcode & 0x0f);
    offset += 1;
    const lengthByteOffset = offset;

    if (payload.length < 126) {
      frame[offset] = payload.length;
      offset += 1;
    } else if (payload.length < 65_536) {
      frame[offset] = 126;
      offset += 1;
      frame.writeUInt16BE(payload.length, offset);
      offset += 2;
    } else {
      frame[offset] = 127;
      offset += 1;
      frame.writeBigUInt64BE(BigInt(payload.length), offset);
      offset += 8;
    }

    if (this.maskOutgoing) {
      const mask = randomBytes(4);
      frame[lengthByteOffset] |= 0x80;
      mask.copy(frame, offset);
      offset += 4;
      for (let index = 0; index < payload.length; index += 1) {
        frame[offset + index] = payload[index] ^ mask[index % 4];
      }
      this.socket.write(frame);
      return;
    }

    payload.copy(frame, offset);
    this.socket.write(frame);
  }
}

async function createClientTransport(port: number): Promise<BridgeTransport> {
  const socket = net.createConnection({ host: DEFAULT_HOST, port });
  const key = randomBytes(16).toString('base64');

  return await new Promise<BridgeTransport>((resolve, reject) => {
    let settled = false;
    let handshakeBuffer = Buffer.alloc(0);
    let connection: RawWebSocketConnection | null = null;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.once('error', fail);
    socket.once('connect', () => {
      socket.write(
        [
          'GET / HTTP/1.1',
          `Host: ${DEFAULT_HOST}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ].join('\r\n'),
      );
    });

    socket.on('data', (chunk) => {
      if (settled) return;

      handshakeBuffer = Buffer.concat([handshakeBuffer, Buffer.from(chunk)]);
      const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
      const expectedAccept = createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
      if (
        !headerText.startsWith('HTTP/1.1 101') ||
        !headerText.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)
      ) {
        fail(new Error(`WebSocket handshake failed on port ${port}.`));
        return;
      }

      settled = true;
      socket.removeListener('error', fail);
      socket.removeAllListeners('data');

      connection = new RawWebSocketConnection(
        socket,
        true,
        handshakeBuffer.subarray(headerEnd + 4),
      );
      resolve({
        send(data) {
          connection?.sendText(data);
        },
        close(code, reason) {
          connection?.close(code, reason);
          connection?.terminate();
        },
        onMessage(handler) {
          const listener = (data: string) => handler(data);
          connection?.on('message', listener);
          return () => {
            connection?.off('message', listener);
          };
        },
        onClose(handler) {
          const listener = () => handler();
          connection?.on('close-connection', listener);
          return () => {
            connection?.off('close-connection', listener);
          };
        },
        isOpen() {
          return socket.readyState === 'open';
        },
      });
    });

    socket.once('close', () => {
      if (!settled) fail(new Error(`Unable to connect to IDE bridge on port ${port}.`));
    });
  });
}

function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const upgrade = request.headers.upgrade;
  const connection = request.headers.connection;
  return (
    typeof upgrade === 'string' &&
    upgrade.toLowerCase() === 'websocket' &&
    typeof connection === 'string' &&
    connection
      .toLowerCase()
      .split(',')
      .some((value) => value.trim() === 'upgrade')
  );
}

function parseBridgeMessage(raw: string): BridgeMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BridgeMessage>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      parsed.type !== 'openFile' &&
      parsed.type !== 'editFile' &&
      parsed.type !== 'showDiff' &&
      parsed.type !== 'navigate' &&
      parsed.type !== 'diagnostic' &&
      parsed.type !== 'status'
    ) {
      return null;
    }
    return { type: parsed.type, payload: parsed.payload };
  } catch {
    return null;
  }
}
