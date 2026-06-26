import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let bookmarks: typeof import('../../src/session/bookmarks.js');
let configRef: typeof import('../../src/config.js').config;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-bookmarks-'));
  process.env.ICOPILOT_SESSION_DIR = tmpDir;
  vi.resetModules();

  const configModule = await import('../../src/config.js');
  bookmarks = await import('../../src/session/bookmarks.js');
  configRef = configModule.config;
  configRef.sessionDir = tmpDir;
});

afterEach(() => {
  delete process.env.ICOPILOT_SESSION_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bookmarks', () => {
  it('adds, lists, gets, and deletes bookmarks', () => {
    const bookmark = bookmarks.addBookmark('session-a', 'start', 2, 'hello');

    expect(bookmark).toMatchObject({ sessionId: 'session-a', name: 'start', index: 2, preview: 'hello' });
    expect(bookmarks.bookmarksPath()).toBe(path.join(tmpDir, 'bookmarks.json'));
    expect(bookmarks.listBookmarks('session-a')).toHaveLength(1);
    expect(bookmarks.getBookmark('session-a', 'start')).toMatchObject({ index: 2 });
    expect(bookmarks.deleteBookmark('session-a', 'start')).toBe(true);
    expect(bookmarks.getBookmark('session-a', 'start')).toBeNull();
    expect(bookmarks.deleteBookmark('session-a', 'start')).toBe(false);
  });

  it('upserts by session id and name', () => {
    bookmarks.addBookmark('session-a', 'same', 1, 'first');
    bookmarks.addBookmark('session-a', 'same', 3, 'second');

    expect(bookmarks.listBookmarks('session-a')).toHaveLength(1);
    expect(bookmarks.getBookmark('session-a', 'same')).toMatchObject({ index: 3, preview: 'second' });
  });

  it('validates names', () => {
    expect(() => bookmarks.addBookmark('session-a', '-bad', 0, '')).toThrow(/Bookmark name/);
    expect(() => bookmarks.addBookmark('session-a', 'bad name', 0, '')).toThrow(/Bookmark name/);
    expect(() => bookmarks.addBookmark('session-a', 'a'.repeat(34), 0, '')).toThrow(/Bookmark name/);
    expect(bookmarks.addBookmark('session-a', 'Good_name-1', 0, '').name).toBe('Good_name-1');
  });

  it('isolates bookmarks across sessions', () => {
    bookmarks.addBookmark('session-a', 'mark', 1, 'a');
    bookmarks.addBookmark('session-b', 'mark', 2, 'b');

    expect(bookmarks.listBookmarks('session-a')).toEqual([
      expect.objectContaining({ sessionId: 'session-a', index: 1 }),
    ]);
    expect(bookmarks.listBookmarks('session-b')).toEqual([
      expect.objectContaining({ sessionId: 'session-b', index: 2 }),
    ]);
    expect(bookmarks.listBookmarks()).toHaveLength(2);
  });
});
