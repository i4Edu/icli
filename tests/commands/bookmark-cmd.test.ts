import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let SessionCtor: typeof import('../../src/session/session.js').Session;
let bookmarkCommand: typeof import('../../src/commands/bookmark-cmd.js').bookmarkCommand;
let configRef: typeof import('../../src/config.js').config;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-bookmark-cmd-'));
  process.env.ICOPILOT_SESSION_DIR = tmpDir;
  vi.resetModules();

  const configModule = await import('../../src/config.js');
  const sessionModule = await import('../../src/session/session.js');
  const commandModule = await import('../../src/commands/bookmark-cmd.js');
  configRef = configModule.config;
  configRef.sessionDir = tmpDir;
  SessionCtor = sessionModule.Session;
  bookmarkCommand = commandModule.bookmarkCommand;
});

afterEach(() => {
  delete process.env.ICOPILOT_SESSION_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bookmarkCommand', () => {
  it('adds, lists, goes to, and deletes bookmarks without mutating messages', () => {
    const session = new SessionCtor({ id: 'cmd-session' });
    session.push({ role: 'user', content: 'first message' });
    session.push({ role: 'assistant', content: 'second message' });
    session.push({ role: 'user', content: 'third message with a longer preview' });

    const add = bookmarkCommand(session, ['add', 'here']);
    expect(add.message).toContain('Bookmarked');

    const list = bookmarkCommand(session, ['list']);
    expect(list.message).toContain('here @ 2');
    expect(list.message).toContain('third message');

    session.push({ role: 'assistant', content: 'after bookmark' });
    const go = bookmarkCommand(session, ['go', 'here']);
    expect(go.message).toContain('Rewind');
    expect(go.rewindTo).toBe(2);
    expect(session.state.messages).toHaveLength(4);

    const deleted = bookmarkCommand(session, ['delete', 'here']);
    expect(deleted.message).toContain('Deleted');
    expect(bookmarkCommand(session, []).message).toContain('No bookmarks');
  });
});
