import fs from 'node:fs';
import path from 'node:path';
import { embed } from './embeddings.js';
import { VectorStore } from './store.js';

export async function retrieve(
  cwd: string,
  query: string,
  topK = 6,
): Promise<Array<{ file: string; chunk: number; text: string; score: number }>> {
  const indexPath = path.join(cwd, '.icopilot', 'index.json');
  if (!fs.existsSync(indexPath)) return [];

  const store = new VectorStore(indexPath);
  store.load();
  const [queryVec] = await embed([query]);
  if (!queryVec) return [];

  return store.search(queryVec, topK).map(({ entry, score }) => ({
    file: entry.file,
    chunk: entry.chunk,
    text: entry.text,
    score,
  }));
}
