import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let SessionCtor: typeof import('../../src/session/session.js').Session;
let configRef: typeof import('../../src/config.js').config;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-session-'));
  process.env.ICOPILOT_SESSION_DIR = tmpDir;
  vi.resetModules();

  const configModule = await import('../../src/config.js');
  const sessionModule = await import('../../src/session/session.js');
  configRef = configModule.config;
  configRef.sessionDir = tmpDir;
  SessionCtor = sessionModule.Session;
}, 30_000);

afterEach(() => {
  delete process.env.ICOPILOT_SESSION_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Session', { timeout: 30_000 }, () => {
  it('pushes, persists, resets, estimates token usage, and compacts history', () => {
    const session = new SessionCtor({ id: 'test-session', model: 'model-a', cwd: tmpDir });
    const firstMessage: ChatCompletionMessageParam = { role: 'user', content: 'hello world' };
    const secondMessage: ChatCompletionMessageParam = {
      role: 'assistant',
      content: [{ type: 'text', text: 'structured content' }],
    } as ChatCompletionMessageParam;

    session.push(firstMessage);
    session.push(secondMessage);

    const persistedPath = path.join(tmpDir, 'test-session.json');
    const persisted = JSON.parse(fs.readFileSync(persistedPath, 'utf8')) as {
      messages: ChatCompletionMessageParam[];
    };
    expect(persisted.messages).toHaveLength(2);
    expect(session.tokenUsage()).toBeGreaterThan(0);

    session.compactInto('short summary');
    expect(session.state.messages).toHaveLength(1);
    expect(session.state.messages[0]).toMatchObject({ role: 'system' });
    expect(String(session.state.messages[0].content)).toContain('short summary');

    session.reset();
    expect(session.state.messages).toEqual([]);
    const afterReset = JSON.parse(fs.readFileSync(persistedPath, 'utf8')) as {
      messages: ChatCompletionMessageParam[];
    };
    expect(afterReset.messages).toEqual([]);
  });

  it('updates model, mode, and cwd with persistence', () => {
    const session = new SessionCtor({ id: 'stateful-session' });

    session.setModel('gpt-test');
    session.setMode('plan');
    session.setCwd(tmpDir);
    session.setTodos([
      {
        id: 'todo-1',
        text: 'persist todo',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    session.setPinned([
      {
        path: path.join(tmpDir, 'notes.ts'),
        addedAt: '2024-01-01T00:00:00.000Z',
        tokens: 12,
      },
    ]);

    expect(session.state.model).toBe('gpt-test');
    expect(session.state.mode).toBe('plan');
    expect(session.state.cwd).toBe(tmpDir);
    expect(session.state.todos).toHaveLength(1);
    expect(session.state.pinned).toEqual([
      {
        path: path.join(tmpDir, 'notes.ts'),
        addedAt: '2024-01-01T00:00:00.000Z',
        tokens: 12,
      },
    ]);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'stateful-session.json'), 'utf8'),
    ) as {
      model: string;
      mode: string;
      cwd: string;
      todos: Array<{ text: string }>;
      pinned: Array<{ path: string; tokens: number }>;
    };
    expect(persisted).toMatchObject({ model: 'gpt-test', mode: 'plan', cwd: tmpDir });
    expect(persisted.todos[0]?.text).toBe('persist todo');
    expect(persisted.pinned[0]).toMatchObject({ path: path.join(tmpDir, 'notes.ts'), tokens: 12 });

    const loaded = SessionCtor.load('stateful-session');
    expect(loaded.state.pinned[0]).toMatchObject({ path: path.join(tmpDir, 'notes.ts'), tokens: 12 });
  });
});
