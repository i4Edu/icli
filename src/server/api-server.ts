import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { parseFileRefs, renderFileRefBlock } from '../context/file-refs.js';
import { streamChat } from '../api/github-models.js';
import { config } from '../config.js';
import { buildSystemPrompt } from '../modes/turn.js';
import { Session } from '../session/session.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';

const MAX_TOOL_HOPS = 6;
export const DEFAULT_API_PORT = 8787;

interface JSONRecord {
  [key: string]: unknown;
}

interface ChatRequestBody extends JSONRecord {
  message?: string;
  prompt?: string;
  sessionId?: string;
  model?: string;
  mode?: 'ask' | 'plan';
  stream?: boolean;
}

interface CommandRequestBody extends JSONRecord {
  command?: string;
  sessionId?: string;
}

interface SessionCreateBody extends JSONRecord {
  cwd?: string;
  model?: string;
  mode?: 'ask' | 'plan';
  systemPrompt?: string;
}

interface ServerEvent {
  event: string;
  data: unknown;
}

export class APIServer {
  private server: http.Server | null = null;
  private sessions = new Map<string, Session>();
  private activeSessionId: string | null = null;
  private readonly startedAt = Date.now();

  async start(port = DEFAULT_API_PORT): Promise<number> {
    if (this.server) {
      return this.getPort() ?? port;
    }

    this.server = http.createServer(async (req, res) => {
      await this.route(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    return this.getPort() ?? port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === 'object' ? (address as AddressInfo).port : undefined;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;

    if (!this.isAuthorized(req, pathname)) {
      this.writeJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        this.writeJson(res, 200, {
          ok: true,
          status: 'ok',
          port: this.getPort() ?? DEFAULT_API_PORT,
          uptimeMs: Date.now() - this.startedAt,
          authRequired: this.requiresApiKey(),
          sessionCount: this.getSessionCount(),
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/models') {
        const activeModels = [
          ...new Set([...this.sessions.values()].map((session) => session.state.model)),
        ];
        this.writeJson(res, 200, {
          defaultModel: config.defaultModel,
          endpoint: config.endpoint,
          models: [...new Set([config.defaultModel, ...activeModels])],
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/session') {
        const sessionId = requestUrl.searchParams.get('id') || undefined;
        if (sessionId) {
          const session = this.resolveSession(sessionId);
          if (!session) {
            this.writeJson(res, 404, { error: `Session not found: ${sessionId}` });
            return;
          }
          this.writeJson(res, 200, { session: serializeSession(session) });
          return;
        }

        const current = this.resolveSession();
        this.writeJson(res, 200, {
          current: current ? serializeSession(current) : null,
          recent: Session.list().slice(0, 10),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/session/new') {
        const body = await this.readJson<SessionCreateBody>(req);
        const session = new Session({
          cwd: typeof body.cwd === 'string' ? body.cwd : config.cwd,
          model: typeof body.model === 'string' ? body.model : config.defaultModel,
          mode: body.mode === 'plan' ? 'plan' : 'ask',
        });
        if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
          session.setSystemPrompt(body.systemPrompt.trim());
        }
        await session.initializeGitContext().catch(() => []);
        this.trackSession(session);
        this.writeJson(res, 201, { session: serializeSession(session) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/command') {
        const body = await this.readJson<CommandRequestBody>(req);
        const rawCommand = typeof body.command === 'string' ? body.command.trim() : '';
        if (!rawCommand) {
          this.writeJson(res, 400, { error: 'Missing command.' });
          return;
        }

        const session = this.resolveOrCreateSession(body.sessionId);
        const command = rawCommand.startsWith('/') ? rawCommand : `/${rawCommand}`;
        const { handleSlash } = await import('../commands/slash.js');
        const commandResult = await handleSlash(command, {
          session,
          abort: new AbortController(),
          exit: () => undefined,
        });

        this.trackSession(session);
        this.writeJson(res, 200, {
          result: commandResult,
          session: serializeSession(session),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await this.readJson<ChatRequestBody>(req);
        const prompt = typeof body.message === 'string' ? body.message : body.prompt;
        if (typeof prompt !== 'string' || !prompt.trim()) {
          this.writeJson(res, 400, { error: 'Missing message.' });
          return;
        }

        const session = this.resolveOrCreateSession(body.sessionId);
        if (typeof body.model === 'string' && body.model.trim()) {
          session.setModel(body.model.trim());
        }
        if (body.mode === 'ask' || body.mode === 'plan') {
          session.setMode(body.mode);
        }
        this.trackSession(session);

        const wantsSSE =
          body.stream !== false || (req.headers.accept || '').includes('text/event-stream');
        const abort = new AbortController();
        req.on('aborted', () => abort.abort());
        res.on('close', () => {
          if (!res.writableEnded) abort.abort();
        });

        if (wantsSSE) {
          this.writeSSEHeaders(res);
          this.writeSSE(res, {
            event: 'session',
            data: {
              sessionId: session.state.id,
              model: session.state.model,
              mode: session.state.mode,
            },
          });
          try {
            const result = await runSessionChat({
              session,
              userInput: prompt.trim(),
              signal: abort.signal,
              onToken: (delta) => {
                this.writeSSE(res, { event: 'delta', data: { delta } });
              },
              onEvent: (event) => {
                this.writeSSE(res, event);
              },
            });
            this.writeSSE(res, {
              event: 'done',
              data: {
                content: result.content,
                finishReason: result.finishReason,
                toolCalls: result.toolCalls,
                session: serializeSession(session),
              },
            });
            res.end();
          } catch (error) {
            this.writeSSE(res, { event: 'error', data: formatError(error) });
            res.end();
          }
          return;
        }

        try {
          const result = await runSessionChat({
            session,
            userInput: prompt.trim(),
            signal: abort.signal,
          });
          this.writeJson(res, 200, {
            content: result.content,
            finishReason: result.finishReason,
            toolCalls: result.toolCalls,
            session: serializeSession(session),
          });
        } catch (error) {
          this.writeJson(res, 500, { error: formatError(error) });
        }
        return;
      }

      this.writeJson(res, 404, { error: `Route not found: ${req.method || 'GET'} ${pathname}` });
    } catch (error) {
      this.writeJson(res, 500, { error: formatError(error) });
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
  }

  private writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  private writeSSEHeaders(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
  }

  private writeSSE(res: ServerResponse, message: ServerEvent): void {
    res.write(`event: ${message.event}\n`);
    res.write(`data: ${JSON.stringify(message.data)}\n\n`);
  }

  private requiresApiKey(): boolean {
    return Boolean(process.env.ICOPILOT_API_KEY?.trim());
  }

  private isAuthorized(req: IncomingMessage, pathname: string): boolean {
    if (pathname === '/api/health') return true;
    const expected = process.env.ICOPILOT_API_KEY?.trim();
    if (!expected) return true;

    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey === expected) return true;

    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim() === expected;
    }

    return false;
  }

  private async readJson<T extends JSONRecord>(req: IncomingMessage): Promise<T> {
    const raw = await readBody(req);
    if (!raw.trim()) return {} as T;
    return JSON.parse(raw) as T;
  }

  private trackSession(session: Session): Session {
    this.sessions.set(session.state.id, session);
    this.activeSessionId = session.state.id;
    return session;
  }

  private resolveSession(sessionId?: string): Session | null {
    if (sessionId) {
      const cached = this.sessions.get(sessionId);
      if (cached) return cached;
      try {
        return this.trackSession(Session.load(sessionId));
      } catch {
        return null;
      }
    }

    if (this.activeSessionId) {
      const current = this.sessions.get(this.activeSessionId);
      if (current) return current;
    }

    return null;
  }

  private resolveOrCreateSession(sessionId?: string): Session {
    return this.resolveSession(sessionId) ?? this.trackSession(new Session());
  }
}

let globalServer: APIServer | null = null;

export function getGlobalAPIServer(): APIServer {
  globalServer ??= new APIServer();
  return globalServer;
}

export async function stopGlobalAPIServer(): Promise<void> {
  if (!globalServer) return;
  await globalServer.stop();
  globalServer = null;
}

interface SessionChatResult {
  content: string;
  finishReason: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

interface RunSessionChatOptions {
  session: Session;
  userInput: string;
  signal: AbortSignal;
  onToken?: (delta: string) => void;
  onEvent?: (event: ServerEvent) => void;
}

async function runSessionChat(opts: RunSessionChatOptions): Promise<SessionChatResult> {
  const { session, userInput, signal, onToken, onEvent } = opts;
  const refs = parseFileRefs(userInput);
  const refBlock = renderFileRefBlock(refs);
  const sys: ChatCompletionMessageParam = {
    role: 'system',
    content: buildSystemPrompt(session),
  };
  const userMsg: ChatCompletionMessageParam = {
    role: 'user',
    content: refBlock ? `${userInput}\n\n${refBlock}` : userInput,
  };
  session.push(userMsg);

  let content = '';
  let finishReason: string | null = null;
  let finalToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    let assistantContent = '';
    const result = await streamChat({
      model: session.state.model,
      messages: [sys, ...session.state.messages],
      tools: session.state.mode === 'ask' ? TOOL_SCHEMAS : undefined,
      signal,
      onToken: (delta) => {
        assistantContent += delta;
        onToken?.(delta);
      },
    });

    content += assistantContent;
    finishReason = result.finishReason;
    finalToolCalls = result.toolCalls;

    session.push({
      role: 'assistant',
      content: assistantContent,
      ...(result.toolCalls.length
        ? {
            tool_calls: result.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments || '{}',
              },
            })),
          }
        : {}),
    });

    if (!result.toolCalls.length || result.finishReason === 'stop') {
      return { content, finishReason, toolCalls: result.toolCalls };
    }

    onEvent?.({
      event: 'tool-calls',
      data: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
      } catch {
        parsedArgs = { __raw: toolCall.arguments };
      }

      const toolName =
        typeof toolCall.name === 'string' ? toolCall.name : String(toolCall.name ?? '');
      const toolArgs =
        parsedArgs && typeof parsedArgs === 'object' ? (parsedArgs as Record<string, any>) : {};
      const output = await dispatchTool(toolName, toolArgs);
      session.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: output,
      } as unknown as ChatCompletionMessageParam);
      onEvent?.({
        event: 'tool-result',
        data: {
          id: toolCall.id,
          name: toolCall.name,
          output,
        },
      });
    }
  }

  return { content, finishReason, toolCalls: finalToolCalls };
}

function serializeSession(session: Session): JSONRecord {
  return {
    id: session.state.id,
    createdAt: session.state.createdAt,
    model: session.state.model,
    mode: session.state.mode,
    cwd: session.state.cwd,
    messageCount: session.state.messages.length,
    autopilotEnabled: Boolean(session.state.autopilotEnabled),
    todos: session.state.todos,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
  }
  return body;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : `Unexpected error (${randomUUID()})`;
}
