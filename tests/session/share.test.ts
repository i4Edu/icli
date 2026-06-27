import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workDir: string;
let sessionDir: string;
let SessionCtor: typeof import('../../src/session/session.js').Session;
let configRef: typeof import('../../src/config.js').config;
let shareModule: typeof import('../../src/session/share.js');

beforeEach(async () => {
  const root = path.join(process.cwd(), '.test-share-work');
  fs.mkdirSync(root, { recursive: true });
  workDir = path.join(root, randomUUID());
  sessionDir = path.join(workDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  process.env.ICOPILOT_SESSION_DIR = sessionDir;
  vi.resetModules();

  const configModule = await import('../../src/config.js');
  const sessionModule = await import('../../src/session/session.js');
  shareModule = await import('../../src/session/share.js');

  configRef = configModule.config;
  configRef.sessionDir = sessionDir;
  configRef.cwd = workDir;
  SessionCtor = sessionModule.Session;
}, 30_000);

afterEach(() => {
  delete process.env.ICOPILOT_SESSION_DIR;
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('session sharing', () => {
  function createSession() {
    const session = new SessionCtor({
      id: 'share-source',
      createdAt: '2024-01-01T00:00:00.000Z',
      model: 'gpt-test',
      cwd: workDir,
      mode: 'plan',
    });
    session.setTodos([
      {
        id: 'todo-1',
        text: 'Ship session sharing',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    session.setPinned([
      {
        path: path.join(workDir, 'notes.txt'),
        addedAt: '2024-01-01T00:00:05.000Z',
        tokens: 12,
      },
    ]);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Share this debugging session with the team.' },
      {
        role: 'assistant',
        content: 'I inspected the failure and prepared a fix.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_logs', arguments: '{"tail":50}' },
          },
        ],
      } as ChatCompletionMessageParam,
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'Latest logs: stack trace excerpt',
      } as ChatCompletionMessageParam,
    ];
    for (const message of messages) session.push(message);
    return session;
  }

  it('exports a portable bundle with metadata and extended state', () => {
    const session = createSession();
    const bundle = shareModule.exportSessionBundle(session) as ReturnType<
      typeof shareModule.exportSessionBundle
    > & {
      mode?: string;
      todos?: Array<{ text: string }>;
      pinned?: Array<{ path: string }>;
    };

    expect(bundle.version).toBe(1);
    expect(bundle.id).toBe('share-source');
    expect(bundle.title).toContain('Share this debugging session');
    expect(bundle.model).toBe('gpt-test');
    expect(bundle.metadata.cwd).toBe(workDir);
    expect(bundle.metadata.messageCount).toBe(3);
    expect(bundle.metadata.tokensUsed).toBeGreaterThan(0);
    expect(bundle.mode).toBe('plan');
    expect(bundle.todos?.[0]?.text).toBe('Ship session sharing');
    expect(bundle.pinned?.[0]?.path).toContain('notes.txt');
  });

  it('imports bundles from JSON text and restores message state', () => {
    const session = createSession();
    const bundle = shareModule.exportSessionBundle(session);

    const result = shareModule.importSessionBundle(JSON.stringify(bundle));

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId).not.toBe(session.state.id);

    const imported = SessionCtor.load(result.sessionId!);
    expect(imported.state.model).toBe('gpt-test');
    expect(imported.state.mode).toBe('plan');
    expect(imported.state.cwd).toBe(workDir);
    expect(imported.state.messages).toHaveLength(3);
    expect(imported.state.todos[0]?.text).toBe('Ship session sharing');
    expect(imported.state.pinned[0]?.path).toContain('notes.txt');
  });

  it('renders markdown and clipboard views', () => {
    const session = createSession();

    const markdown = shareModule.sessionToMarkdown(session);
    const clipboard = shareModule.sessionToClipboard(session);

    expect(markdown).toContain('# Share this debugging session');
    expect(markdown).toContain('## Metadata');
    expect(markdown).toContain('#### Tool calls');
    expect(markdown).toContain('read_logs');
    expect(clipboard).toContain('[iCopilot]');
    expect(clipboard).toContain('1. user: Share this debugging session');
    expect(clipboard).toContain('tools: read_logs');
  });

  it('handles share command export, import, clipboard, and usage text', () => {
    const session = createSession();
    const exportMessage = shareModule.shareCommand(['export'], session);
    const exportPath = path.join(workDir, `session-${session.state.id}.json`);

    expect(exportMessage).toContain('exported shared session');
    expect(fs.existsSync(exportPath)).toBe(true);

    const clipboard = shareModule.shareCommand(['clipboard'], session);
    expect(clipboard).toContain('session=share-source');

    const importMessage = shareModule.shareCommand(['import', exportPath], session);
    expect(importMessage).toContain('imported session as');

    const usage = shareModule.shareCommand([], session);
    expect(usage).toContain('/share export [path]');
  });

  it('rejects invalid bundle payloads', () => {
    const result = shareModule.importSessionBundle({ version: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('id');
  });
});
