import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'method';
  file: string;
  line: number;
  signature?: string;
  exported: boolean;
}

export interface IndexOptions {
  extensions?: string[];
  exclude?: string[];
  includePrivate?: boolean;
}

interface PersistedIndex {
  rootDir: string;
  createdAt: string;
  symbols: symbol[];
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/coverage/**',
  '**/.icopilot/**',
];

const TOP_LEVEL_PATTERNS: Array<{ kind: symbol['kind']; regex: RegExp }> = [
  {
    kind: 'function',
    regex:
      /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>{\r\n]+>)?\s*\([^)]*\)\s*(?::\s*[^={]+)?/gm,
  },
  {
    kind: 'class',
    regex: /^\s*(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b[^{]*/gm,
  },
  {
    kind: 'interface',
    regex: /^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b[^{=]*/gm,
  },
  {
    kind: 'type',
    regex: /^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\b[^=]*=/gm,
  },
  {
    kind: 'enum',
    regex: /^\s*(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b[^{]*/gm,
  },
  {
    kind: 'variable',
    regex: /^\s*(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\b/gm,
  },
];

const CLASS_PATTERN = /^\s*(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b[^{]*\{/gm;
const METHOD_PATTERN =
  /^\s*(?:(?:public|private|protected|static|async|abstract|override|get|set|readonly)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>{\r\n]+>)?\s*\([^;{}]*\)\s*(?::\s*[^={]+)?\s*\{$/;

export class SymbolIndex {
  private symbols: symbol[] = [];
  private rootDir = '';
  private cachePath = '';

  async build(rootDir: string, options: IndexOptions = {}): Promise<void> {
    const resolvedRoot = path.resolve(rootDir);
    const includePrivate = options.includePrivate ?? true;
    const files = await fg(toPatterns(options.extensions), {
      cwd: resolvedRoot,
      onlyFiles: true,
      dot: false,
      unique: true,
      ignore: [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])],
    });

    const collected: symbol[] = [];
    for (const file of files.sort()) {
      const absolute = path.join(resolvedRoot, file);
      let content = '';
      try {
        content = await fs.promises.readFile(absolute, 'utf8');
      } catch {
        continue;
      }
      const relativeFile = path.normalize(file);
      collected.push(...extractSymbols(content, relativeFile, includePrivate));
    }

    this.rootDir = resolvedRoot;
    this.cachePath = path.join(resolvedRoot, '.icopilot', 'symbol-index.json');
    this.symbols = normalizeSymbols(collected);
    this.save(this.cachePath);
  }

  search(query: string): symbol[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return this.symbols
      .map((symbol) => ({ symbol, score: scoreSymbolName(symbol.name, needle) }))
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.symbol.name.localeCompare(b.symbol.name) ||
          a.symbol.file.localeCompare(b.symbol.file) ||
          a.symbol.line - b.symbol.line,
      )
      .map((item) => item.symbol);
  }

  getByFile(file: string): symbol[] {
    const normalized = normalizeFileKey(file, this.rootDir);
    return this.symbols.filter((symbol) => path.normalize(symbol.file) === normalized);
  }

  getByKind(kind: string): symbol[] {
    return this.symbols.filter((symbol) => symbol.kind === kind);
  }

  getExported(): symbol[] {
    return this.symbols.filter((symbol) => symbol.exported);
  }

  save(filePath: string): void {
    const absolute = path.resolve(filePath);
    const payload: PersistedIndex = {
      rootDir: this.rootDir,
      createdAt: new Date().toISOString(),
      symbols: this.symbols,
    };
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.cachePath = absolute;
  }

  load(filePath: string): void {
    const absolute = path.resolve(filePath);
    const raw = fs.readFileSync(absolute, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedIndex> | symbol[];
    const payload = Array.isArray(parsed)
      ? { rootDir: this.rootDir, symbols: parsed }
      : {
          rootDir: typeof parsed.rootDir === 'string' ? parsed.rootDir : this.rootDir,
          symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
        };

    this.rootDir = payload.rootDir;
    this.cachePath = absolute;
    this.symbols = normalizeSymbols(payload.symbols);
  }
}

function extractSymbols(content: string, file: string, includePrivate: boolean): symbol[] {
  const lineStarts = buildLineStarts(content);
  const depthMap = buildBraceDepthMap(content);
  const symbols: symbol[] = [];

  for (const { kind, regex } of TOP_LEVEL_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
      const [declaration = '', exportToken = '', name = ''] = match;
      if (!name) continue;
      if ((depthMap[match.index ?? 0] ?? 0) !== 0) continue;
      const exported = Boolean(exportToken?.trim());
      if (!includePrivate && !exported) continue;

      symbols.push({
        name,
        kind,
        file,
        line: lineNumberAt(match.index ?? 0, lineStarts),
        signature: cleanSignature(declaration),
        exported,
      });
    }
  }

  for (const block of classBlocks(content)) {
    for (const method of extractMethods(
      block.body,
      lineStarts,
      block.bodyStart,
      file,
      includePrivate,
    )) {
      symbols.push(method);
    }
  }

  return symbols;
}

function classBlocks(content: string): Array<{ body: string; bodyStart: number }> {
  const blocks: Array<{ body: string; bodyStart: number }> = [];

  for (const match of content.matchAll(CLASS_PATTERN)) {
    const fullMatch = match[0] ?? '';
    const openOffset = fullMatch.lastIndexOf('{');
    if (openOffset < 0 || match.index == null) continue;
    const openIndex = match.index + openOffset;
    const closeIndex = findMatchingBrace(content, openIndex);
    if (closeIndex < 0) continue;
    blocks.push({
      body: content.slice(openIndex + 1, closeIndex),
      bodyStart: openIndex + 1,
    });
  }

  return blocks;
}

function extractMethods(
  classBody: string,
  lineStarts: number[],
  bodyStart: number,
  file: string,
  includePrivate: boolean,
): symbol[] {
  const methods: symbol[] = [];
  let depth = 0;
  let current = '';
  let currentStart = 0;
  let started = false;

  for (let i = 0; i < classBody.length; i += 1) {
    const char = classBody[i];

    if (startsWith(classBody, i, '//')) {
      i = skipLineComment(classBody, i + 2);
      continue;
    }
    if (startsWith(classBody, i, '/*')) {
      i = skipBlockComment(classBody, i + 2);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(classBody, i);
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        const signature = `${current}{`;
        const match = METHOD_PATTERN.exec(signature);
        METHOD_PATTERN.lastIndex = 0;
        if (match) {
          const name = match[1] ?? '';
          const isPrivate = name.startsWith('#') || /\b(?:private|protected)\b/.test(signature);
          if (name && name !== 'constructor' && (includePrivate || !isPrivate)) {
            methods.push({
              name,
              kind: 'method',
              file,
              line: lineNumberAt(bodyStart + currentStart, lineStarts),
              signature: cleanSignature(signature),
              exported: false,
            });
          }
        }
      }
      depth += 1;
      current = '';
      started = false;
      continue;
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        current = '';
        started = false;
      }
      continue;
    }

    if (depth > 0) continue;

    if (!started && !/\s/.test(char)) {
      currentStart = i;
      started = true;
    }
    current += char;
    if (char === ';') {
      current = '';
      started = false;
    }
  }

  return methods;
}

function toPatterns(extensions?: string[]): string[] {
  const values = extensions?.length ? extensions : DEFAULT_EXTENSIONS;
  const patterns = values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.includes('*') || trimmed.includes('/')) return trimmed;
    const normalized = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    return `**/*${normalized}`;
  });
  return patterns.filter(Boolean);
}

function normalizeSymbols(symbols: symbol[]): symbol[] {
  const byKey = new Map<string, symbol>();
  for (const symbol of symbols) {
    if (!symbol || typeof symbol.name !== 'string' || typeof symbol.file !== 'string') continue;
    const normalized: symbol = {
      name: symbol.name,
      kind: symbol.kind,
      file: path.normalize(symbol.file),
      line: Number.isFinite(symbol.line) ? Math.max(1, Math.trunc(symbol.line)) : 1,
      signature: symbol.signature,
      exported: Boolean(symbol.exported),
    };
    byKey.set(
      `${normalized.file}:${normalized.line}:${normalized.kind}:${normalized.name}`,
      normalized,
    );
  }

  return [...byKey.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.name.localeCompare(b.name) ||
      a.kind.localeCompare(b.kind),
  );
}

function normalizeFileKey(file: string, rootDir: string): string {
  const target =
    rootDir && path.isAbsolute(file)
      ? path.relative(rootDir, path.resolve(file))
      : path.normalize(file);
  return path.normalize(target);
}

function cleanSignature(signature: string): string {
  return signature
    .replace(/\s+/g, ' ')
    .replace(/\s+\{$/, '')
    .trim();
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function buildBraceDepthMap(text: string): number[] {
  const depthMap = new Array<number>(text.length).fill(0);
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    depthMap[i] = depth;
    const char = text[i];
    if (startsWith(text, i, '//')) {
      i = skipLineComment(text, i + 2);
      continue;
    }
    if (startsWith(text, i, '/*')) {
      i = skipBlockComment(text, i + 2);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(text, i);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth = Math.max(0, depth - 1);
  }

  return depthMap;
}

function lineNumberAt(index: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid] ?? 0;
    const next = lineStarts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
    if (index < start) high = mid - 1;
    else if (index >= next) low = mid + 1;
    else return mid + 1;
  }

  return 1;
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (startsWith(text, i, '//')) {
      i = skipLineComment(text, i + 2);
      continue;
    }
    if (startsWith(text, i, '/*')) {
      i = skipBlockComment(text, i + 2);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(text, i);
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function skipLineComment(text: string, start: number): number {
  let index = start;
  while (index < text.length && text[index] !== '\n') index += 1;
  return index;
}

function skipBlockComment(text: string, start: number): number {
  let index = start;
  while (index < text.length - 1) {
    if (text[index] === '*' && text[index + 1] === '/') return index + 1;
    index += 1;
  }
  return text.length - 1;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;

  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index;
    index += 1;
  }

  return text.length - 1;
}

function startsWith(text: string, index: number, value: string): boolean {
  return text.slice(index, index + value.length) === value;
}

function scoreSymbolName(name: string, query: string): number {
  const candidate = name.toLowerCase();
  if (candidate === query) return 1_000;
  if (candidate.startsWith(query)) return 800 - (candidate.length - query.length);

  const containsIndex = candidate.indexOf(query);
  if (containsIndex >= 0) return 600 - containsIndex * 2 - (candidate.length - query.length);

  let cursor = 0;
  let score = 400;
  for (const char of query) {
    const next = candidate.indexOf(char, cursor);
    if (next < 0) return 0;
    score -= next - cursor;
    cursor = next + 1;
  }
  return Math.max(1, score - (candidate.length - query.length));
}
