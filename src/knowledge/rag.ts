import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { countTokensSync } from '../util/tokens.js';

export interface Chunk {
  id: string;
  text: string;
  tokens: number;
  metadata: {
    file: string;
    startLine: number;
    endLine: number;
  };
}

export interface Document {
  id: string;
  path: string;
  content: string;
  chunks: Chunk[];
}

export interface IndexOptions {
  extensions?: string[];
  maxChunkTokens?: number;
  overlap?: number;
}

export interface IndexStats {
  documents: number;
  chunks: number;
  totalTokens: number;
}

interface Segment {
  text: string;
  tokens: number;
  startLine: number;
  endLine: number;
}

interface SearchMatch {
  chunk: Chunk;
  score: number;
}

interface SerializedIndex {
  version: 1;
  rootDir: string;
  options: Required<IndexOptions>;
  documents: Document[];
}

const DEFAULT_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.py',
  '.go',
  '.java',
  '.rs',
  '.cs',
  '.rb',
];
const DEFAULT_MAX_CHUNK_TOKENS = 400;
const DEFAULT_OVERLAP = 60;
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/coverage/**',
  '**/.icopilot/**',
];
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.rs',
  '.cs',
  '.rb',
]);
const CODE_BOUNDARY_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\b|^\s*(?:export\s+)?const\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>|^\s*(?:public|private|protected)\s+(?:async\s+)?[A-Za-z0-9_$]+\s*\(/;

export function defaultRagIndexPath(rootDir: string): string {
  return path.join(rootDir, '.icopilot', 'rag-index.json');
}

export class RAGIndex {
  private rootDir = process.cwd();
  private options: Required<IndexOptions> = normalizeOptions();
  private documents = new Map<string, Document>();
  private chunks = new Map<string, Chunk>();
  private documentFrequency = new Map<string, number>();
  private inverseDocumentFrequency = new Map<string, number>();
  private chunkVectors = new Map<string, Map<string, number>>();
  private chunkNorms = new Map<string, number>();

  async indexProject(rootDir: string, options?: IndexOptions): Promise<void> {
    this.rootDir = path.resolve(rootDir);
    this.options = normalizeOptions(options);
    this.documents.clear();

    const files = await fg(buildPatterns(this.options.extensions), {
      cwd: this.rootDir,
      onlyFiles: true,
      dot: false,
      ignore: DEFAULT_IGNORES,
    });

    for (const file of files.sort()) {
      this.upsertDocument(path.resolve(this.rootDir, file), false);
    }

    this.rebuildSearchModel();
    this.save(defaultRagIndexPath(this.rootDir));
  }

  search(query: string, k = 5): Chunk[] {
    return this.searchScored(query, k).map((match) => match.chunk);
  }

  addDocument(filePath: string): void {
    this.upsertDocument(filePath, true);
  }

  removeDocument(filePath: string): void {
    const normalized = this.toStoredPath(filePath);
    if (this.documents.delete(normalized)) {
      this.rebuildSearchModel();
    }
  }

  getStats(): IndexStats {
    let chunks = 0;
    let totalTokens = 0;

    for (const document of this.documents.values()) {
      chunks += document.chunks.length;
      totalTokens += document.chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
    }

    return {
      documents: this.documents.size,
      chunks,
      totalTokens,
    };
  }

  save(filePath: string): void {
    const target = path.resolve(filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const payload: SerializedIndex = {
      version: 1,
      rootDir: this.rootDir,
      options: this.options,
      documents: [...this.documents.values()],
    };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  }

  load(filePath: string): void {
    const target = path.resolve(filePath);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<SerializedIndex>;
    this.rootDir = typeof parsed.rootDir === 'string' ? parsed.rootDir : process.cwd();
    this.options = normalizeOptions(parsed.options);
    this.documents.clear();

    for (const document of Array.isArray(parsed.documents) ? parsed.documents : []) {
      if (!document || typeof document.path !== 'string' || typeof document.content !== 'string') continue;
      const chunks = Array.isArray(document.chunks) ? document.chunks.filter(isChunk) : [];
      const doc: Document = {
        id: typeof document.id === 'string' ? document.id : hashId(document.path),
        path: document.path,
        content: document.content,
        chunks,
      };
      this.documents.set(doc.path, doc);
    }

    this.rebuildSearchModel();
  }

  private upsertDocument(filePath: string, rebuild: boolean): void {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(this.rootDir, filePath);
    const storedPath = this.toStoredPath(absolute);
    const content = fs.readFileSync(absolute, 'utf8');
    const chunks = buildChunks(storedPath, content, this.options.maxChunkTokens, this.options.overlap);
    const document: Document = {
      id: hashId(storedPath),
      path: storedPath,
      content,
      chunks,
    };
    this.documents.set(storedPath, document);

    if (rebuild) {
      this.rebuildSearchModel();
    }
  }

  private toStoredPath(filePath: string): string {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(this.rootDir, filePath);
    const relative = path.relative(this.rootDir, absolute);
    const normalized = (relative && !relative.startsWith('..') ? relative : absolute).replace(/\\/g, '/');
    return normalized.replace(/^\.\//, '');
  }

  private rebuildSearchModel(): void {
    this.chunks.clear();
    this.documentFrequency.clear();
    this.inverseDocumentFrequency.clear();
    this.chunkVectors.clear();
    this.chunkNorms.clear();

    const chunkTermCounts = new Map<string, Map<string, number>>();
    const chunkList = [...this.documents.values()].flatMap((document) => document.chunks);

    for (const chunk of chunkList) {
      this.chunks.set(chunk.id, chunk);
      const counts = countTerms(chunk.text);
      if (!counts.size) continue;

      chunkTermCounts.set(chunk.id, counts);
      for (const term of counts.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }

    const totalChunks = Math.max(chunkList.length, 1);
    for (const [term, frequency] of this.documentFrequency) {
      this.inverseDocumentFrequency.set(term, Math.log((1 + totalChunks) / (1 + frequency)) + 1);
    }

    for (const [chunkId, counts] of chunkTermCounts) {
      const vector = new Map<string, number>();
      let sumSquares = 0;

      for (const [term, count] of counts) {
        const weight = (1 + Math.log(count)) * (this.inverseDocumentFrequency.get(term) ?? 1);
        vector.set(term, weight);
        sumSquares += weight * weight;
      }

      this.chunkVectors.set(chunkId, vector);
      this.chunkNorms.set(chunkId, Math.sqrt(sumSquares));
    }
  }

  private searchScored(query: string, k: number): SearchMatch[] {
    const queryCounts = countTerms(query);
    if (!queryCounts.size || !this.chunks.size) return [];

    const totalChunks = Math.max(this.chunks.size, 1);
    const queryVector = new Map<string, number>();
    let querySumSquares = 0;

    for (const [term, count] of queryCounts) {
      const idf = this.inverseDocumentFrequency.get(term) ?? Math.log((1 + totalChunks) / 1) + 1;
      const weight = (1 + Math.log(count)) * idf;
      queryVector.set(term, weight);
      querySumSquares += weight * weight;
    }

    const queryNorm = Math.sqrt(querySumSquares);
    if (!queryNorm) return [];

    return [...this.chunks.values()]
      .map((chunk) => {
        const vector = this.chunkVectors.get(chunk.id);
        const chunkNorm = this.chunkNorms.get(chunk.id) ?? 0;
        if (!vector || !chunkNorm) return null;

        let dot = 0;
        for (const [term, weight] of queryVector) {
          dot += weight * (vector.get(term) ?? 0);
        }

        const score = dot / (queryNorm * chunkNorm);
        return score > 0 ? { chunk, score } : null;
      })
      .filter((match): match is SearchMatch => Boolean(match))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, k));
  }
}

function normalizeOptions(options?: IndexOptions): Required<IndexOptions> {
  const extensions =
    Array.isArray(options?.extensions) && options.extensions.length
      ? options.extensions.map(normalizeExtension)
      : [...DEFAULT_EXTENSIONS];

  return {
    extensions: [...new Set(extensions)],
    maxChunkTokens:
      typeof options?.maxChunkTokens === 'number' && options.maxChunkTokens > 0
        ? Math.floor(options.maxChunkTokens)
        : DEFAULT_MAX_CHUNK_TOKENS,
    overlap:
      typeof options?.overlap === 'number' && options.overlap >= 0
        ? Math.floor(options.overlap)
        : DEFAULT_OVERLAP,
  };
}

function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

function buildPatterns(extensions: string[]): string[] {
  return extensions.map((extension) => `**/*${extension}`);
}

function buildChunks(file: string, content: string, maxTokens: number, overlapTokens: number): Chunk[] {
  const segments = packSegments(
    splitOversizedSegments(splitIntoSegments(file, content), maxTokens),
    maxTokens,
    overlapTokens,
  );

  return segments.map((segmentSet, index) => ({
    id: `${hashId(file)}:${index}`,
    text: segmentSet.map((segment) => segment.text).join('\n\n').trim(),
    tokens: segmentSet.reduce((sum, segment) => sum + segment.tokens, 0),
    metadata: {
      file,
      startLine: segmentSet[0]?.startLine ?? 1,
      endLine: segmentSet[segmentSet.length - 1]?.endLine ?? 1,
    },
  }));
}

function splitIntoSegments(file: string, content: string): Segment[] {
  const lines = content.split(/\r?\n/);
  const extension = path.extname(file).toLowerCase();
  const initial = CODE_EXTENSIONS.has(extension)
    ? splitCodeSegments(lines)
    : splitParagraphSegments(lines);

  return initial
    .map((segment) => ({
      ...segment,
      text: segment.text.trim(),
      tokens: countTokensSync(segment.text.trim()),
    }))
    .filter((segment) => segment.text.length > 0);
}

function splitCodeSegments(lines: string[]): Array<Omit<Segment, 'tokens'>> {
  const boundaries = new Set<number>();
  lines.forEach((line, index) => {
    if (CODE_BOUNDARY_RE.test(line)) {
      boundaries.add(index);
    }
  });

  if (!boundaries.size) {
    return splitParagraphSegments(lines);
  }

  const ordered = [...boundaries].sort((left, right) => left - right);
  const segments: Array<Omit<Segment, 'tokens'>> = [];
  let start = 0;

  for (const boundary of ordered) {
    if (boundary > start) {
      pushSegment(segments, lines, start, boundary - 1);
    }
    start = boundary;
  }

  pushSegment(segments, lines, start, lines.length - 1);
  return segments;
}

function splitParagraphSegments(lines: string[]): Array<Omit<Segment, 'tokens'>> {
  const segments: Array<Omit<Segment, 'tokens'>> = [];
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const heading = /^#{1,6}\s/.test(trimmed);

    if (trimmed.length === 0) {
      if (start >= 0) {
        pushSegment(segments, lines, start, index - 1);
        start = -1;
      }
      continue;
    }

    if (heading && start >= 0) {
      pushSegment(segments, lines, start, index - 1);
      start = index;
      continue;
    }

    if (start < 0) {
      start = index;
    }
  }

  if (start >= 0) {
    pushSegment(segments, lines, start, lines.length - 1);
  }

  return segments;
}

function splitOversizedSegments(segments: Segment[], maxTokens: number): Segment[] {
  const result: Segment[] = [];

  for (const segment of segments) {
    if (segment.tokens <= maxTokens) {
      result.push(segment);
      continue;
    }

    const lines = segment.text.split('\n');
    let startLine = segment.startLine;
    let buffer: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const nextBuffer = [...buffer, line];
      const nextText = nextBuffer.join('\n').trim();
      const nextTokens = countTokensSync(nextText);

      if (buffer.length > 0 && nextTokens > maxTokens) {
        const bufferedText = buffer.join('\n').trim();
        result.push({
          text: bufferedText,
          tokens: countTokensSync(bufferedText),
          startLine,
          endLine: startLine + buffer.length - 1,
        });
        startLine += buffer.length;
        buffer = [line];
        continue;
      }

      buffer = nextBuffer;
    }

    if (buffer.length > 0) {
      const bufferedText = buffer.join('\n').trim();
      result.push({
        text: bufferedText,
        tokens: countTokensSync(bufferedText),
        startLine,
        endLine: startLine + buffer.length - 1,
      });
    }
  }

  return result;
}

function packSegments(segments: Segment[], maxTokens: number, overlapTokens: number): Segment[][] {
  if (!segments.length) return [];

  const groups: Segment[][] = [];
  let window: Segment[] = [];
  let windowTokens = 0;
  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];
    if (window.length > 0 && windowTokens + segment.tokens > maxTokens) {
      groups.push(window);
      window = buildOverlap(window, overlapTokens);
      windowTokens = window.reduce((sum, item) => sum + item.tokens, 0);

      while (window.length > 0 && windowTokens + segment.tokens > maxTokens) {
        const removed = window.shift();
        if (!removed) break;
        windowTokens -= removed.tokens;
      }
      continue;
    }

    window.push(segment);
    windowTokens += segment.tokens;
    index += 1;
  }

  if (window.length > 0) {
    groups.push(window);
  }

  return groups;
}

function buildOverlap(segments: Segment[], overlapTokens: number): Segment[] {
  if (overlapTokens <= 0) return [];

  const overlap: Segment[] = [];
  let tokens = 0;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    overlap.unshift(segment);
    tokens += segment.tokens;
    if (tokens >= overlapTokens) break;
  }

  return overlap;
}

function pushSegment(
  segments: Array<Omit<Segment, 'tokens'>>,
  lines: string[],
  startIndex: number,
  endIndex: number,
): void {
  if (startIndex > endIndex) return;
  const text = lines.slice(startIndex, endIndex + 1).join('\n').trim();
  if (!text) return;
  segments.push({
    text,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
  });
}

function countTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const terms =
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z0-9_]+/g) ?? [];

  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return counts;
}

function hashId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function isChunk(value: unknown): value is Chunk {
  if (!value || typeof value !== 'object') return false;
  const chunk = value as Partial<Chunk>;
  return (
    typeof chunk.id === 'string' &&
    typeof chunk.text === 'string' &&
    typeof chunk.tokens === 'number' &&
    typeof chunk.metadata?.file === 'string' &&
    typeof chunk.metadata?.startLine === 'number' &&
    typeof chunk.metadata?.endLine === 'number'
  );
}
