import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VectorStore, type IndexEntry } from '../../src/index/store.js';

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-store-'));
  file = path.join(tmpDir, 'index.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry(id: string, vec: number[]): IndexEntry {
  return { id, file: `${id}.ts`, chunk: 0, text: id, vector: vec, sha: id };
}

describe('VectorStore', () => {
  it('search returns most similar first', () => {
    const s = new VectorStore(file);
    s.addAll([entry('a', [1, 0, 0]), entry('b', [0, 1, 0]), entry('c', [0.9, 0.1, 0])]);
    const hits = s.search([1, 0, 0], 3);
    expect(hits[0].entry.id).toBe('a');
    expect(hits[1].entry.id).toBe('c');
    expect(hits[0].score).toBeCloseTo(1);
  });

  it('save + load roundtrip preserves entries', () => {
    const s = new VectorStore(file);
    s.addAll([entry('x', [1, 2, 3])]);
    s.save();
    const s2 = new VectorStore(file);
    s2.load();
    expect(s2.entries).toHaveLength(1);
    expect(s2.entries[0].id).toBe('x');
    expect(s2.search([1, 2, 3], 1)[0].score).toBeCloseTo(1);
  });

  it('zero vector returns score 0', () => {
    const s = new VectorStore(file);
    s.addAll([entry('z', [0, 0, 0])]);
    expect(s.search([1, 1, 1], 1)[0].score).toBe(0);
  });
});
