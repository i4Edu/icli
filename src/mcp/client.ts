import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import type { McpServerConfig } from './config.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly name: string,
    private readonly config: McpServerConfig,
  ) {}

  async start(): Promise<void> {
    if (this.proc) return;
    this.proc = spawn(this.config.command, this.config.args || [], {
      cwd: this.config.cwd,
      env: { ...process.env, ...(this.config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[MCP/${this.name}] ${chunk.toString()}`);
    });
    this.proc.on('error', (err) => this.rejectAll(err));
    this.proc.on('exit', (code) => {
      this.rejectAll(new Error(`MCP server ${this.name} exited (${code ?? 'signal'})`));
      this.proc = null;
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'icopilot', version: '0.4.0' },
    });
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.request('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const result = await this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' ? args : {},
    });
    if (Array.isArray(result?.content)) {
      return result.content
        .map((item: any) => {
          if (typeof item?.text === 'string') return item.text;
          return JSON.stringify(item);
        })
        .join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  stop(): void {
    this.rejectAll(new Error(`MCP server ${this.name} stopped`));
    this.proc?.kill();
    this.proc = null;
  }

  private request(method: string, params: unknown): Promise<any> {
    if (!this.proc) throw new Error(`MCP server ${this.name} is not running`);
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    this.write(payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.proc) return;
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(payload: Record<string, unknown>): void {
    const json = JSON.stringify(payload);
    this.proc?.stdin.write(json + '\n');
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const message = this.readMessage();
      if (!message) break;
      this.handleMessage(message);
    }
  }

  private readMessage(): any | null {
    if (this.buffer[0] === 67) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return null;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return null;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return null;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      return JSON.parse(body);
    }

    const newline = this.buffer.indexOf('\n');
    if (newline === -1) return null;
    const line = this.buffer.subarray(0, newline).toString('utf8').trim();
    this.buffer = this.buffer.subarray(newline + 1);
    if (!line) return null;
    return JSON.parse(line);
  }

  private handleMessage(message: any): void {
    if (typeof message?.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'MCP error'));
    else pending.resolve(message.result);
  }

  private rejectAll(reason: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
