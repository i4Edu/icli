import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface Bookmark {
  sessionId: string;
  name: string;
  index: number;
  createdAt: string;
  preview: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,32}$/i;

export function bookmarksPath(): string {
  fs.mkdirSync(config.sessionDir, { recursive: true });
  return path.join(config.sessionDir, 'bookmarks.json');
}

export function listBookmarks(sessionId?: string): Bookmark[] {
  const bookmarks = readBookmarks();
  return sessionId ? bookmarks.filter((bookmark) => bookmark.sessionId === sessionId) : bookmarks;
}

export function addBookmark(
  sessionId: string,
  name: string,
  index: number,
  preview: string,
): Bookmark {
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Bookmark name must match /^[a-z0-9][a-z0-9_-]{0,32}$/i.');
  }

  const bookmarks = readBookmarks();
  const bookmark: Bookmark = {
    sessionId,
    name,
    index,
    createdAt: new Date().toISOString(),
    preview,
  };
  const existing = bookmarks.findIndex(
    (item) => item.sessionId === sessionId && item.name === name,
  );
  if (existing === -1) {
    bookmarks.push(bookmark);
  } else {
    bookmarks[existing] = bookmark;
  }
  writeBookmarks(bookmarks);
  return bookmark;
}

export function getBookmark(sessionId: string, name: string): Bookmark | null {
  return (
    readBookmarks().find(
      (bookmark) => bookmark.sessionId === sessionId && bookmark.name === name,
    ) ?? null
  );
}

export function deleteBookmark(sessionId: string, name: string): boolean {
  const bookmarks = readBookmarks();
  const remaining = bookmarks.filter(
    (bookmark) => bookmark.sessionId !== sessionId || bookmark.name !== name,
  );
  if (remaining.length === bookmarks.length) return false;
  writeBookmarks(remaining);
  return true;
}

function readBookmarks(): Bookmark[] {
  const file = bookmarksPath();
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBookmark);
  } catch {
    return [];
  }
}

function writeBookmarks(bookmarks: Bookmark[]): void {
  fs.writeFileSync(bookmarksPath(), JSON.stringify(bookmarks, null, 2), 'utf8');
}

function isBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== 'object') return false;
  const bookmark = value as Record<string, unknown>;
  return (
    typeof bookmark.sessionId === 'string' &&
    typeof bookmark.name === 'string' &&
    typeof bookmark.index === 'number' &&
    typeof bookmark.createdAt === 'string' &&
    typeof bookmark.preview === 'string'
  );
}
