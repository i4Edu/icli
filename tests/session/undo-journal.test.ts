import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let journal: typeof import('../../src/session/undo-journal.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-undo-journal-'));
  vi.resetModules();
  const configModule = await import('../../src/config.js');
  configModule.config.sessionDir = path.join(tmpDir, 'session');
  journal = await import('../../src/session/undo-journal.js');
  journal.clearJournal();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('undo journal', () => {
  it('round-trips a new-file create through undo and redo', () => {
    const filePath = path.join(tmpDir, 'created.txt');
    fs.writeFileSync(filePath, 'hello');

    const entry = journal.recordWrite(filePath, null, 'hello');

    expect(journal.journalSize()).toEqual({ undo: 1, redo: 0 });
    expect(journal.undoLast()).toEqual({ entry, restored: 'prev' });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(journal.journalSize()).toEqual({ undo: 0, redo: 1 });

    expect(journal.redoLast()).toEqual({ entry, restored: 'next' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello');
    expect(journal.journalSize()).toEqual({ undo: 1, redo: 0 });
  });

  it('round-trips an existing-file overwrite through undo and redo', () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'old');
    fs.writeFileSync(filePath, 'new');

    const entry = journal.recordWrite(filePath, 'old', 'new');

    expect(journal.undoLast()).toEqual({ entry, restored: 'prev' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('old');

    expect(journal.redoLast()).toEqual({ entry, restored: 'next' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new');
  });

  it('enforces a fifty-entry cap on each stack', () => {
    const entries = Array.from({ length: 55 }, (_, index) => {
      const filePath = path.join(tmpDir, `file-${index}.txt`);
      fs.writeFileSync(filePath, `next-${index}`);
      return journal.recordWrite(filePath, `prev-${index}`, `next-${index}`);
    });

    expect(journal.journalSize()).toEqual({ undo: 50, redo: 0 });

    for (let index = 0; index < 55; index += 1) {
      journal.undoLast();
    }

    expect(journal.journalSize()).toEqual({ undo: 0, redo: 50 });
    expect(journal.redoLast()?.entry.id).toBe(entries[54].id);
    expect(journal.redoLast()?.entry.id).toBe(entries[53].id);
  });

  it('persists entries across module reloads', async () => {
    const filePath = path.join(tmpDir, 'persisted.txt');
    fs.writeFileSync(filePath, 'next');
    const entry = journal.recordWrite(filePath, 'prev', 'next');

    vi.resetModules();
    const configModule = await import('../../src/config.js');
    configModule.config.sessionDir = path.join(tmpDir, 'session');
    const reloaded = await import('../../src/session/undo-journal.js');

    expect(reloaded.journalSize()).toEqual({ undo: 1, redo: 0 });
    expect(reloaded.undoLast()).toEqual({ entry, restored: 'prev' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('prev');
  });
});
