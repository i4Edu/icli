import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { embed } from './embeddings.js';
import { type IndexEntry, VectorStore } from './store.js';

const DEFAULT_INCLUDE = ['**/*.{ts,tsx,js,jsx,md,py,go,rs,java,rb,cs,json,yaml,yml,toml}'];
const DEFAULT_IGNORE = ['node_modules/**', 'dist/**', '.git/**', 'coverage/**'];
const MAX_FILE_BYTES = 256 * 1024;
const OVERLAP_CHARS = 200;

export async function buildIndex(
  cwd: string,
  opts: { include?: string[]; ignore?: string[]; chunkChars?: number } = {},
): Promise<{ files: number; chunks: number; ms: number; outPath: string }> {
  const started = Date.now();
  const outPath = path.join(cwd, '.icopilot', 'index.json');
  const store = new VectorStore(outPath);
  const existing = store.load().entries;
  const existingByFile = new Map<string, IndexEntry[]>();
  for (const entry of existing) {
    const bucket = existingByFile.get(entry.file) ?? [];
    bucket.push(entry);
    existingByFile.set(entry.file, bucket);
  }

  const files = await fg(opts.include ?? DEFAULT_INCLUDE, {
    cwd,
    ignore: opts.ignore ?? DEFAULT_IGNORE,
    onlyFiles: true,
    dot: false,
  });

  const chunkChars = opts.chunkChars ?? 1500;
  const retained: IndexEntry[] = [];
  const pending: Array<{ file: string; sha: string; chunks: string[] }> = [];

  for (const file of files.sort()) {
    const absolute = path.join(cwd, file);
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_FILE_BYTES) continue;

    const content = await fs.readFile(absolute, 'utf8');
    const sha = sha1(content);
    const oldEntries = existingByFile.get(file);
    if (oldEntries?.length && oldEntries.every((entry) => entry.sha === sha)) {
      retained.push(...oldEntries);
      continue;
    }

    const chunks = chunkText(content, chunkChars);
    if (chunks.length) pending.push({ file, sha, chunks });
  }

  const texts = pending.flatMap((item) => item.chunks);
  const vectors = await embed(texts);
  const fresh: IndexEntry[] = [];
  let vectorIndex = 0;
  for (const item of pending) {
    item.chunks.forEach((text, chunk) => {
      fresh.push({
        id: `${item.file}:${item.sha}:${chunk}`,
        file: item.file,
        chunk,
        text,
        vector: vectors[vectorIndex++],
        sha: item.sha,
      });
    });
  }

  store.replaceAll([...retained, ...fresh]);
  store.save();

  return {
    files: files.length,
    chunks: fresh.length,
    ms: Date.now() - started,
    outPath,
  };
}

function chunkText(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, chunkChars - OVERLAP_CHARS);
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + chunkChars).trim();
    if (chunk) chunks.push(chunk);
    if (start + chunkChars >= text.length) break;
  }
  return chunks;
}

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}
