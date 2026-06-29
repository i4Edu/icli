import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { URL } from 'node:url';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { parseFileRefs, renderFileRefBlock } from '../context/file-refs.js';
import {
  buildImageContent,
  detectImagePaths,
  isVisionCapableModel,
  type MessageContentPart,
} from '../context/image-input.js';
import { streamChat } from '../api/github-models.js';
import { config } from '../config.js';
import { buildSystemPrompt } from '../modes/turn.js';
import { Session } from '../session/session.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';
import { AcpRouter } from '../acp/router.js';
import path from 'node:path';
import os from 'node:os';

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
  private readonly acpRouter = new AcpRouter({
    onLog: (level, message, data) => {
      if (config.verbose) {
        console.error(`[ACP ${level.toUpperCase()}] ${message}`, data || '');
      }
    },
  });

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

      if (req.method === 'POST' && pathname === '/acp') {
        await this.handleAcpRequest(req, res);
        return;
      }

      if (req.method === 'GET' && pathname === '/') {
        this.writeHtml(res, renderWebUiShell(this.requiresApiKey()));
        return;
      }

      if (req.method === 'GET' && pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
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
          schedulePrompt: async (prompt) => {
            await runSessionChat({
              session,
              userInput: prompt,
              signal: new AbortController().signal,
            });
          },
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

      if (req.method === 'POST' && pathname === '/webhooks/slack') {
        await this.handleSlackWebhook(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/webhooks/teams') {
        await this.handleTeamsWebhook(req, res);
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

  private async handleAcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('application/json')) {
      this.writeJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Content-Type must be application/json' },
      });
      return;
    }

    try {
      const body = await readBody(req);
      const request = body.trim() ? JSON.parse(body) : {};

      const response = await this.acpRouter.handle(request);
      const statusCode = response.error ? 200 : 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(response));
    } catch (error) {
      const errorMsg = error instanceof SyntaxError ? 'Invalid JSON' : 'Request processing failed';
      this.writeJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: errorMsg },
      });
    }
  }

  private writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  private writeHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
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
    if (
      pathname === '/api/health' ||
      pathname === '/' ||
      pathname === '/favicon.ico' ||
      pathname === '/acp' ||
      pathname === '/webhooks/slack' ||
      pathname === '/webhooks/teams'
    ) {
      return true;
    }
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

  private async handleSlackWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const slackSigningSecret = process.env.ICOPILOT_SLACK_SIGNING_SECRET;

    try {
      const body = await readBody(req);
      const payload = JSON.parse(body) as Record<string, unknown>;

      if (payload.type === 'url_verification') {
        this.writeJson(res, 200, { challenge: payload.challenge });
        return;
      }

      if (slackSigningSecret) {
        const signature = req.headers['x-slack-signature'] as string | undefined;
        const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

        if (!signature || !timestamp || !this.validateSlackSignature(signature, timestamp, body, slackSigningSecret)) {
          this.writeJson(res, 401, { error: 'Invalid signature' });
          return;
        }
      }

      const { getNotificationHandler } = await import('../extensions/team.js');
      const { SlackNotificationHandler } = await import('../extensions/slack-provider.js');
      const handler = getNotificationHandler();

      if (handler instanceof SlackNotificationHandler) {
        handler.handleWebhookEvent(payload);
      }

      this.writeJson(res, 200, { ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[webhooks] Slack webhook error: ${msg}\n`);
      this.writeJson(res, 400, { error: msg });
    }
  }

  private async handleTeamsWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const queryParams = new URL(`http://localhost${req.url || '/'}`, 'http://localhost').searchParams;
      const id = queryParams.get('id');
      const approved = req.url?.includes('/approve') ?? false;

      if (!id) {
        this.writeJson(res, 400, { error: 'Missing approval ID' });
        return;
      }

      const { getNotificationHandler } = await import('../extensions/team.js');
      const { TeamsNotificationHandler } = await import('../extensions/teams-provider.js');
      const handler = getNotificationHandler();

      if (handler instanceof TeamsNotificationHandler) {
        const userId = (JSON.parse(body) as Record<string, unknown>)?.from?.id as string | undefined;
        handler.handleApprovalResponse(id, approved, userId);
      }

      this.writeJson(res, 200, { ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[webhooks] Teams webhook error: ${msg}\n`);
      this.writeJson(res, 400, { error: msg });
    }
  }

  private validateSlackSignature(signature: string, timestamp: string, body: string, secret: string): boolean {
    const baseString = `v0:${timestamp}:${body}`;
    const computed = `v0=${createHmac('sha256', secret).update(baseString).digest('hex')}`;
    return computed === signature;
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
  const promptInput = refBlock ? `${userInput}\n\n${refBlock}` : userInput;
  const imagePaths = detectImagePaths(userInput);
  const userContent = buildUserMessageContent(
    promptInput,
    imagePaths,
    session.state.cwd,
    session.state.model,
    (warning) =>
      onEvent?.({
        event: 'warning',
        data: { message: warning },
      }),
  );
  const sys: ChatCompletionMessageParam = {
    role: 'system',
    content: buildSystemPrompt(session),
  };
  const userMsg: ChatCompletionMessageParam = {
    role: 'user',
    content: userContent,
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

function buildUserMessageContent(
  text: string,
  imagePaths: string[],
  cwd: string,
  model: string,
  onWarning: (warning: string) => void,
): string | MessageContentPart[] {
  if (!imagePaths.length) return text;
  if (!isVisionCapableModel(model)) {
    onWarning(
      `model "${model}" does not support image input; ignoring ${imagePaths.length} image reference${imagePaths.length === 1 ? '' : 's'}.`,
    );
    return text;
  }

  const content: MessageContentPart[] = [{ type: 'text', text }];
  const resolvedImagePaths = imagePaths.map((imagePath) => resolveImagePath(imagePath, cwd));

  for (const imagePath of resolvedImagePaths) {
    try {
      content.push(...buildImageContent([imagePath]));
    } catch (error: any) {
      onWarning(`unable to attach image ${imagePath}: ${error?.message || error}`);
    }
  }

  return content.length > 1 ? content : text;
}

function resolveImagePath(filePath: string, cwd: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function renderWebUiShell(authRequired: boolean): string {
  const authHint = authRequired
    ? 'API key required. Provide it below to call /api/chat.'
    : 'No API key required.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>iCopilot Browser UI</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: ui-sans-serif, system-ui; background: #0b0f17; color: #e6edf3; }
    .container { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { margin: 0 0 8px; font-size: 1.3rem; }
    .hint { color: #9fb0c0; margin-bottom: 16px; }
    textarea, input, button { font: inherit; }
    textarea, input { width: 100%; box-sizing: border-box; background: #111826; color: #e6edf3; border: 1px solid #273244; border-radius: 8px; padding: 10px; }
    textarea { min-height: 120px; resize: vertical; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 8px; }
    button { background: #2563eb; border: 0; border-radius: 8px; color: white; padding: 10px 14px; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    pre { white-space: pre-wrap; background: #0f172a; border: 1px solid #273244; border-radius: 8px; padding: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>iCopilot Browser UI</h1>
    <div class="hint">${authHint}</div>
    <label>API key (optional)</label>
    <input id="apiKey" placeholder="X-API-Key value" />
    <label style="display:block; margin-top:10px;">Message</label>
    <textarea id="prompt" placeholder="Ask iCopilot..."></textarea>
    <div class="row">
      <input id="sessionId" placeholder="sessionId (optional)" />
      <button id="send" type="button">Send</button>
    </div>
    <pre id="output">Ready.</pre>
  </div>
  <script>
    const output = document.getElementById('output');
    const promptEl = document.getElementById('prompt');
    const apiKeyEl = document.getElementById('apiKey');
    const sessionIdEl = document.getElementById('sessionId');
    const sendButton = document.getElementById('send');

    async function send() {
      const message = promptEl.value.trim();
      if (!message) return;
      sendButton.disabled = true;
      output.textContent = 'Thinking...';
      try {
        const headers = { 'content-type': 'application/json' };
        const key = apiKeyEl.value.trim();
        if (key) headers['x-api-key'] = key;
        const payload = { message, sessionId: sessionIdEl.value.trim() || undefined, stream: false };
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const json = await response.json();
        if (!response.ok) {
          output.textContent = JSON.stringify(json, null, 2);
          return;
        }
        if (json.session && json.session.id) sessionIdEl.value = json.session.id;
        output.textContent = json.content || '(no content)';
      } catch (error) {
        output.textContent = String(error);
      } finally {
        sendButton.disabled = false;
      }
    }

    sendButton.addEventListener('click', send);
    promptEl.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        send();
      }
    });
  </script>
</body>
</html>`;
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
