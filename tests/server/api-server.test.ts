import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import { APIServer } from '../../src/server/api-server.js';
import { Session } from '../../src/session/session.js';

const streamChatMock = vi.hoisted(() => vi.fn());
const handleSlashMock = vi.hoisted(() => vi.fn());
const dispatchToolMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/github-models.js', () => ({
  streamChat: streamChatMock,
}));

vi.mock('../../src/commands/slash.js', () => ({
  handleSlash: handleSlashMock,
}));

vi.mock('../../src/modes/turn.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('../../src/tools/registry.js', () => ({
  TOOL_SCHEMAS: [],
  dispatchTool: dispatchToolMock,
}));

describe('APIServer', () => {
  let server: APIServer;
  let baseUrl: string;
  let tmpRoot: string;
  let originalSessionDir: string;
  let originalCwd: string;
  let originalDefaultModel: string;
  let originalApiKey: string | undefined;
  let initializeGitContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpRoot = path.join(process.cwd(), '.vitest-api-server-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });

    originalSessionDir = config.sessionDir;
    originalCwd = config.cwd;
    originalDefaultModel = config.defaultModel;
    originalApiKey = process.env.ICOPILOT_API_KEY;

    config.sessionDir = path.join(tmpRoot, 'sessions');
    config.cwd = tmpRoot;
    config.defaultModel = 'gpt-test';
    delete process.env.ICOPILOT_API_KEY;

    streamChatMock.mockReset();
    handleSlashMock.mockReset();
    dispatchToolMock.mockReset();
    initializeGitContextSpy = vi
      .spyOn(Session.prototype, 'initializeGitContext')
      .mockResolvedValue([]);

    server = new APIServer();
    const port = await server.start(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    config.sessionDir = originalSessionDir;
    config.cwd = originalCwd;
    config.defaultModel = originalDefaultModel;
    if (originalApiKey === undefined) {
      delete process.env.ICOPILOT_API_KEY;
    } else {
      process.env.ICOPILOT_API_KEY = originalApiKey;
    }
    initializeGitContextSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('serves health and models responses with CORS headers', async () => {
    const uiResponse = await fetch(`${baseUrl}/`);
    expect(uiResponse.status).toBe(200);
    expect(uiResponse.headers.get('content-type')).toContain('text/html');
    expect(await uiResponse.text()).toContain('iCopilot Browser UI');

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get('access-control-allow-origin')).toBe('*');
    expect(await healthResponse.json()).toMatchObject({ ok: true, status: 'ok' });

    const modelsResponse = await fetch(`${baseUrl}/api/models`);
    expect(modelsResponse.status).toBe(200);
    expect(await modelsResponse.json()).toEqual({
      defaultModel: 'gpt-test',
      endpoint: config.endpoint,
      models: ['gpt-test'],
    });
  });

  it('creates and retrieves sessions', async () => {
    const createResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'plan', cwd: tmpRoot }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { session: { id: string; mode: string } };
    expect(created.session.mode).toBe('plan');

    const sessionResponse = await fetch(`${baseUrl}/api/session?id=${created.session.id}`);
    expect(sessionResponse.status).toBe(200);
    const payload = (await sessionResponse.json()) as {
      session: { id: string; mode: string; cwd: string };
    };
    expect(payload.session).toMatchObject({
      id: created.session.id,
      mode: 'plan',
      cwd: tmpRoot,
    });
  });

  it('routes slash commands through /api/command', async () => {
    handleSlashMock.mockResolvedValue({ handled: true, consumed: true });

    const response = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: '/serve status' }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: { id: string };
      result: { handled: boolean; consumed: boolean };
    };
    expect(handleSlashMock).toHaveBeenCalled();
    expect(payload.result).toEqual({ handled: true, consumed: true });
    expect(payload.session.id).toBeTruthy();
  });

  it('streams chat responses over SSE', async () => {
    streamChatMock.mockImplementation(async ({ onToken }: { onToken: (delta: string) => void }) => {
      onToken('Hello');
      onToken(' world');
      return { content: 'Hello world', toolCalls: [], finishReason: 'stop' };
    });

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Hi server' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('event: session');
    expect(body).toContain('"delta":"Hello"');
    expect(body).toContain('"delta":" world"');
    expect(body).toContain('event: done');

    const sessionResponse = await fetch(`${baseUrl}/api/session`);
    const sessionPayload = (await sessionResponse.json()) as {
      current: { messageCount: number } | null;
    };
    expect(sessionPayload.current?.messageCount).toBe(2);
  });

  it('enforces optional API key auth', async () => {
    process.env.ICOPILOT_API_KEY = 'secret';

    const unauthorized = await fetch(`${baseUrl}/api/models`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/api/models`, {
      headers: { 'x-api-key': 'secret' },
    });
    expect(authorized.status).toBe(200);
  });
});
