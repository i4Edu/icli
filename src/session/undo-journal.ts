import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface JournalEntry {
  id: string;
  ts: number;
  path: string;
  prevBytes: string | null;
  nextBytes: string | null;
}

interface JournalState {
  undo: JournalEntry[];
  redo: JournalEntry[];
}

const STACK_LIMIT = 50;
const JOURNAL_FILE = 'undo-journal.json';

function journalPath(): string {
  return path.join(config.sessionDir, JOURNAL_FILE);
}

function emptyState(): JournalState {
  return { undo: [], redo: [] };
}

function ensureSessionDir(): void {
  fs.mkdirSync(config.sessionDir, { recursive: true });
}

function loadJournal(): JournalState {
  ensureSessionDir();
  try {
    const raw = fs.readFileSync(journalPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<JournalState>;
    return {
      undo: Array.isArray(parsed.undo) ? parsed.undo : [],
      redo: Array.isArray(parsed.redo) ? parsed.redo : [],
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    return emptyState();
  }
}

function capStack(stack: JournalEntry[]): JournalEntry[] {
  return stack.slice(Math.max(0, stack.length - STACK_LIMIT));
}

function saveJournal(state: JournalState): void {
  ensureSessionDir();
  const capped = { undo: capStack(state.undo), redo: capStack(state.redo) };
  fs.writeFileSync(journalPath(), `${JSON.stringify(capped, null, 2)}\n`, 'utf8');
}

function restorePath(absPath: string, bytes: string | null): void {
  if (bytes === null) {
    fs.rmSync(absPath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

export function recordWrite(
  absPath: string,
  prevBytes: string | null,
  nextBytes: string | null,
): JournalEntry {
  const state = loadJournal();
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    path: path.resolve(absPath),
    prevBytes,
    nextBytes,
  };
  state.undo.push(entry);
  state.undo = capStack(state.undo);
  state.redo = [];
  saveJournal(state);
  return entry;
}

export function undoLast(): { entry: JournalEntry; restored: 'prev' } | null {
  const state = loadJournal();
  const entry = state.undo.pop();
  if (!entry) return null;
  restorePath(entry.path, entry.prevBytes);
  state.redo.push(entry);
  state.redo = capStack(state.redo);
  saveJournal(state);
  return { entry, restored: 'prev' };
}

export function redoLast(): { entry: JournalEntry; restored: 'next' } | null {
  const state = loadJournal();
  const entry = state.redo.shift();
  if (!entry) return null;
  restorePath(entry.path, entry.nextBytes);
  state.undo.push(entry);
  state.undo = capStack(state.undo);
  saveJournal(state);
  return { entry, restored: 'next' };
}

export function journalSize(): { undo: number; redo: number } {
  const state = loadJournal();
  return { undo: state.undo.length, redo: state.redo.length };
}

export function clearJournal(): void {
  saveJournal(emptyState());
}
