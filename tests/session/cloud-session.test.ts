import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workDir: string;
let sessionDir: string;
let cloudStorePath: string;
let output = '';
let stdoutSpy: ReturnType<typeof vi.spyOn>;

let configRef: typeof import('../../src/config.js').config;
let SessionCtor: typeof import('../../src/session/session.js').Session;
let CloudSessionCtor: typeof import('../../src/session/cloud-session.js').CloudSession;

beforeEach(async () => {
  const root = path.join(process.cwd(), '.vitest-cloud-session-tmp');
  fs.mkdirSync(root, { recursive: true });
  workDir = path.join(root, randomUUID());
  sessionDir = path.join(workDir, 'sessions');
  cloudStorePath = path.join(workDir, 'cloud-sessions.json');
  fs.mkdirSync(sessionDir, { recursive: true });

  process.env.ICOPILOT_SESSION_DIR = sessionDir;
  process.env.ICOPILOT_CLOUD_SESSIONS_PATH = cloudStorePath;
  process.env.USERPROFILE = workDir;
  process.env.HOME = workDir;

  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });

  vi.resetModules();
  const configModule = await import('../../src/config.js');
  const sessionModule = await import('../../src/session/session.js');
  const cloudSessionModule = await import('../../src/session/cloud-session.js');

  configRef = configModule.config;
  configRef.cwd = workDir;
  configRef.sessionDir = sessionDir;
  SessionCtor = sessionModule.Session;
  CloudSessionCtor = cloudSessionModule.CloudSession;
}, 90_000);

afterEach(() => {
  stdoutSpy.mockRestore();
  delete process.env.ICOPILOT_SESSION_DIR;
  delete process.env.ICOPILOT_CLOUD_SESSIONS_PATH;
  delete process.env.USERPROFILE;
  delete process.env.HOME;
  fs.rmSync(workDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('CloudSession', { timeout: 90_000 }, () => {
  it('creates, connects, sends, lists, and destroys cloud sessions', async () => {
    const cloud = new CloudSessionCtor({ endpoint: 'https://cloud.example.test', apiKey: 'secret' });

    const created = await cloud.create({ name: 'demo-session' });
    expect(created.name).toBe('demo-session');
    expect(created.status).toBe('connected');
    expect(fs.existsSync(cloudStorePath)).toBe(true);

    await cloud.disconnect();
    expect(cloud.getConnectedSessionId()).toBeUndefined();

    const connected = await cloud.connect(created.id);
    expect(connected.id).toBe(created.id);
    expect(cloud.getConnectedSessionId()).toBe(created.id);

    const sendResult = await cloud.send('hello cloud');
    expect(sendResult.sessionId).toBe(created.id);
    expect(sendResult.response).toContain('hello cloud');
    expect(sendResult.messageCount).toBe(2);

    const listed = await cloud.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      endpoint: 'https://cloud.example.test',
      status: 'connected',
      messageCount: 2,
    });

    const status = await cloud.getStatus(created.id);
    expect(status).toMatchObject({
      id: created.id,
      exists: true,
      status: 'connected',
      messageCount: 2,
    });

    await expect(cloud.destroy(created.id)).resolves.toBe(true);
    await expect(cloud.getStatus(created.id)).resolves.toMatchObject({
      id: created.id,
      exists: false,
      status: 'missing',
    });
  });

  it('syncs a local session snapshot into the cloud session', async () => {
    const localSession = new SessionCtor({
      id: 'local-sync',
      cwd: workDir,
      model: 'gpt-sync',
      mode: 'plan',
    });
    localSession.push({ role: 'user', content: 'sync me' });
    localSession.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'structured reply' }],
    } as any);

    const cloud = new CloudSessionCtor({ endpoint: 'https://cloud.example.test' });
    const created = await cloud.create({ name: 'mirror' });
    const synced = await cloud.sync(created.id, localSession);

    expect(synced.lastSyncedAt).toBeTruthy();
    expect(synced.messageCount).toBe(2);
    expect(synced.snapshot).toMatchObject({
      id: 'local-sync',
      model: 'gpt-sync',
      mode: 'plan',
      cwd: workDir,
    });
    expect(synced.messages.map((message) => message.content)).toEqual(['sync me', 'structured reply']);

    const listed = await cloud.list();
    expect(listed[0]?.snapshot?.messages).toHaveLength(2);
    expect(listed[0]?.lastMessage).toBe('structured reply');
  });

  it('wires /cloud slash commands and shell completion', async () => {
    const { bashCompletion, defaultContext, pwshCompletion, zshCompletion } = await import(
      '../../src/util/completion.js'
    );
    const slashSource = fs.readFileSync(path.join(process.cwd(), 'src', 'commands', 'slash.ts'), 'utf8');

    expect(slashSource).toContain('/cloud create [name]');
    expect(slashSource).toContain('/cloud connect <id>');
    expect(slashSource).toContain('/cloud list');
    expect(slashSource).toContain('/cloud destroy <id>');
    expect(slashSource).toContain('/cloud sync');
    expect(slashSource).toContain("case 'cloud':");
    expect(slashSource).toContain("action === 'create'");
    expect(slashSource).toContain("action === 'connect'");
    expect(slashSource).toContain("action === 'list'");
    expect(slashSource).toContain("action === 'destroy'");
    expect(slashSource).toContain("action === 'sync'");

    expect(defaultContext().slashCommands).toContain('cloud');
    expect(bashCompletion()).toContain('/cloud');
    expect(zshCompletion()).toContain('/cloud');
    expect(pwshCompletion()).toContain('/cloud');
  });
});
