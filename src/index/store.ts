import fs from 'node:fs';
import path from 'node:path';

export interface IndexEntry {
  id: string;
  file: string;
  chunk: number;
  text: string;
  vector: number[];
  sha: string;
}

export interface IndexFile {
  model: string;
  createdAt: string;
  entries: IndexEntry[];
}

export class VectorStore {
  private data: IndexFile = { model: 'text-embedding-3-small', createdAt: '', entries: [] };
  private norms = new Map<string, number>();

  constructor(private readonly file: string) {}

  get index(): IndexFile {
    return this.data;
  }

  get entries(): IndexEntry[] {
    return this.data.entries;
  }

  load(): IndexFile {
    if (!fs.existsSync(this.file)) {
      this.data = { model: 'text-embedding-3-small', createdAt: '', entries: [] };
      this.rebuildNorms();
      return this.data;
    }

    const raw = fs.readFileSync(this.file, 'utf8');
    const parsed = JSON.parse(raw) as IndexFile;
    this.data = {
      model: parsed.model || 'text-embedding-3-small',
      createdAt: parsed.createdAt || '',
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
    this.rebuildNorms();
    return this.data;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data.createdAt = new Date().toISOString();
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  addAll(entries: IndexEntry[]): void {
    const byId = new Map(this.data.entries.map((entry) => [entry.id, entry]));
    for (const entry of entries) {
      byId.set(entry.id, entry);
      this.norms.set(entry.id, norm(entry.vector));
    }
    this.data.entries = [...byId.values()];
    this.rebuildNorms();
  }

  replaceAll(entries: IndexEntry[]): void {
    this.data.entries = [...entries];
    this.rebuildNorms();
  }

  search(queryVec: number[], topK = 8): Array<{ entry: IndexEntry; score: number }> {
    const queryNorm = norm(queryVec);
    return this.data.entries
      .map((entry) => ({
        entry,
        score: cosine(
          queryVec,
          queryNorm,
          entry.vector,
          this.norms.get(entry.id) ?? norm(entry.vector),
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private rebuildNorms(): void {
    this.norms = new Map(this.data.entries.map((entry) => [entry.id, norm(entry.vector)]));
  }
}

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function cosine(a: number[], aNorm: number, b: number[], bNorm: number): number {
  if (!aNorm || !bNorm) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}
