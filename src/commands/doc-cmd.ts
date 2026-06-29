import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { theme } from '../ui/theme.js';

export interface DocOptions {
  file: string;
  symbol?: string;
  style?: string;
  overwrite?: boolean;
}

export interface UndocumentedSymbol {
  name: string;
  file: string;
  line: number;
  kind: string;
}

type DocStyle = 'jsdoc' | 'tsdoc' | 'numpy' | 'google';
type Language = 'javascript' | 'typescript' | 'python';

interface DocumentableSymbol extends UndocumentedSymbol {
  documented: boolean;
  indent: string;
  signature: string;
  language: Language;
}

const DOC_STYLES = new Set<DocStyle>(['jsdoc', 'tsdoc', 'numpy', 'google']);
const SOURCE_GLOBS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.py',
];
const IGNORE_GLOBS = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'];

export function generateDoc(code: string, style: string): string {
  const resolvedStyle = normalizeStyle(style);
  const signature = parseSignature(code);

  switch (resolvedStyle) {
    case 'jsdoc':
      return buildJsLikeDoc(signature, { includeThrows: true });
    case 'tsdoc':
      return buildJsLikeDoc(signature, { includeThrows: false });
    case 'numpy':
      return buildPythonDoc(signature, 'numpy');
    case 'google':
      return buildPythonDoc(signature, 'google');
  }
}

export function findUndocumented(rootDir: string): UndocumentedSymbol[] {
  const matches: UndocumentedSymbol[] = [];
  const files = fg.sync(SOURCE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: IGNORE_GLOBS,
  });

  for (const file of files) {
    const code = safeReadFile(file);
    if (!code) continue;

    for (const symbol of collectSymbols(code, file)) {
      if (!symbol.documented && isProjectExport(symbol, code)) {
        matches.push({
          name: symbol.name,
          file,
          line: symbol.line,
          kind: symbol.kind,
        });
      }
    }
  }

  return matches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function docCommand(args: string[], cwd: string): string {
  const parsed = parseDocArgs(args);
  if (parsed.error) return `${theme.warn(parsed.error)}\n`;

  if (parsed.all) {
    return handleAllDocs(cwd, parsed.style, parsed.overwrite);
  }

  if (!parsed.file) {
    return `${theme.warn('usage: /doc <file> [symbol] [--style <jsdoc|tsdoc|numpy|google>] [--overwrite]')}\n`;
  }

  const options: DocOptions = {
    file: parsed.file,
    symbol: parsed.symbol,
    style: parsed.style,
    overwrite: parsed.overwrite,
  };
  return handleSingleDoc(options, cwd);
}

function handleSingleDoc(options: DocOptions, cwd: string): string {
  const resolvedFile = path.resolve(cwd, options.file);
  const code = safeReadFile(resolvedFile);
  if (!code) return `${theme.err(`unable to read file: ${resolvedFile}`)}\n`;

  const symbols = collectSymbols(code, resolvedFile);
  const style = normalizeStyle(options.style, resolvedFile);

  if (options.symbol) {
    const symbol = symbols.find((entry) => entry.name === options.symbol);
    if (!symbol) {
      return `${theme.warn(`symbol not found: ${options.symbol}`)}\n`;
    }

    if (options.overwrite) {
      writeDocsToFile(resolvedFile, code, [symbol], style);
      return `${theme.ok(`✔ wrote ${style} docs for ${symbol.name}`)}\n`;
    }

    const doc = indentDoc(
      generateDoc(symbol.signature, style),
      symbol.language === 'python' ? nextIndent(symbol.indent) : symbol.indent,
    );
    return `${theme.brand('Generated docs')} ${theme.dim(`${resolvedFile}:${symbol.line}`)}\n\n${doc}\n`;
  }

  const targets = symbols.filter((symbol) => !symbol.documented);
  if (targets.length === 0) {
    return `${theme.dim(`No undocumented functions or classes found in ${resolvedFile}.\n`)}`;
  }

  if (options.overwrite) {
    writeDocsToFile(resolvedFile, code, targets, style);
    return `${theme.ok(`✔ wrote ${targets.length} ${style} doc block${targets.length === 1 ? '' : 's'} in ${resolvedFile}`)}\n`;
  }

  const blocks = targets.map((symbol) => {
    const doc = indentDoc(
      generateDoc(symbol.signature, style),
      symbol.language === 'python' ? nextIndent(symbol.indent) : symbol.indent,
    );
    return `${theme.hl(`${symbol.kind} ${symbol.name}`)} ${theme.dim(`line ${symbol.line}`)}\n${doc}`;
  });

  return `${theme.brand('Generated docs')} ${theme.dim(resolvedFile)}\n\n${blocks.join('\n\n')}\n`;
}

function handleAllDocs(cwd: string, requestedStyle?: string, overwrite = false): string {
  const missing = findUndocumented(cwd);
  if (missing.length === 0) return `${theme.dim('No undocumented exports found.\n')}`;

  if (overwrite) {
    const byFile = groupByFile(missing);
    let written = 0;

    for (const [file, symbols] of byFile) {
      const code = safeReadFile(file);
      if (!code) continue;
      const available = collectSymbols(code, file);
      const targets = symbols
        .map((entry) =>
          available.find(
            (candidate) => candidate.name === entry.name && candidate.line === entry.line,
          ),
        )
        .filter((entry): entry is DocumentableSymbol => Boolean(entry));
      if (!targets.length) continue;
      writeDocsToFile(file, code, targets, normalizeStyle(requestedStyle, file));
      written += targets.length;
    }

    return `${theme.ok(`✔ wrote ${written} doc block${written === 1 ? '' : 's'} across ${byFile.size} file${byFile.size === 1 ? '' : 's'}`)}\n`;
  }

  const lines = missing.map((entry) => {
    const style = normalizeStyle(requestedStyle, entry.file);
    return `  ${theme.ok(entry.name)} ${theme.dim(`(${entry.kind}, ${path.relative(cwd, entry.file)}:${entry.line}, ${style})`)}`;
  });

  return `${theme.brand('Undocumented exports')}\n${lines.join('\n')}\n`;
}

function writeDocsToFile(
  filePath: string,
  code: string,
  symbols: DocumentableSymbol[],
  style: DocStyle,
): void {
  const lines = code.split(/\r?\n/);
  const sorted = [...symbols].sort((a, b) => b.line - a.line);

  for (const symbol of sorted) {
    const insertAt = Math.max(0, symbol.line - 1);
    const doc = generateDoc(symbol.signature, style);
    const indent = symbol.language === 'python' ? nextIndent(symbol.indent) : symbol.indent;
    const docLines = indentDoc(doc, indent).split('\n');

    if (symbol.language === 'python') {
      lines.splice(insertAt + 1, 0, ...docLines);
    } else {
      lines.splice(insertAt, 0, ...docLines);
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function collectSymbols(code: string, filePath: string): DocumentableSymbol[] {
  const language = detectLanguage(filePath);
  return language === 'python'
    ? collectPythonSymbols(code, filePath)
    : collectJsLikeSymbols(code, filePath, language);
}

function collectJsLikeSymbols(
  code: string,
  filePath: string,
  language: Exclude<Language, 'python'>,
): DocumentableSymbol[] {
  const lines = code.split(/\r?\n/);
  const symbols: DocumentableSymbol[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const signature = line.trim();
    const match =
      line.match(
        /^(?<indent>\s*)(?<export>export\s+(?:default\s+)?)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\(/,
      ) ??
      line.match(/^(?<indent>\s*)(?<export>export\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\b/) ??
      line.match(
        /^(?<indent>\s*)(?<export>export\s+)?const\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
      ) ??
      line.match(
        /^(?<indent>\s*)(?<export>export\s+)?const\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/,
      );

    if (!match?.groups?.name) continue;

    symbols.push({
      name: match.groups.name,
      file: filePath,
      line: index + 1,
      kind: signature.includes('class ') ? 'class' : 'function',
      documented: hasLeadingBlockDoc(lines, index),
      indent: match.groups.indent ?? '',
      signature,
      language,
    });
  }

  return symbols;
}

function collectPythonSymbols(code: string, filePath: string): DocumentableSymbol[] {
  const lines = code.split(/\r?\n/);
  const symbols: DocumentableSymbol[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match =
      line.match(/^(?<indent>\s*)def\s+(?<name>[A-Za-z_][\w]*)\s*\(/) ??
      line.match(/^(?<indent>\s*)class\s+(?<name>[A-Za-z_][\w]*)\b/);

    if (!match?.groups?.name) continue;

    symbols.push({
      name: match.groups.name,
      file: filePath,
      line: index + 1,
      kind: line.includes('class ') ? 'class' : 'function',
      documented: hasPythonDocstring(lines, index),
      indent: match.groups.indent ?? '',
      signature: line.trim(),
      language: 'python',
    });
  }

  return symbols;
}

function isProjectExport(symbol: DocumentableSymbol, code: string): boolean {
  if (symbol.language === 'python') return true;
  const line = code.split(/\r?\n/)[symbol.line - 1] ?? '';
  return /\bexport\b/.test(line);
}

function hasLeadingBlockDoc(lines: string[], symbolIndex: number): boolean {
  for (let index = symbolIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.endsWith('*/')) return true;
    return false;
  }

  return false;
}

function hasPythonDocstring(lines: string[], symbolIndex: number): boolean {
  for (let index = symbolIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    return line.startsWith('"""') || line.startsWith("'''");
  }

  return false;
}

function parseSignature(code: string): {
  kind: 'function' | 'class';
  name?: string;
  params: string[];
  returns: boolean;
  throws: boolean;
} {
  const trimmed = code.trim();
  const kind = /\bclass\b/.test(trimmed) ? 'class' : 'function';
  const name =
    trimmed.match(/\b(?:function|class|def)\s+([A-Za-z_$][\w$]*)/)?.[1] ??
    trimmed.match(/\bconst\s+([A-Za-z_$][\w$]*)\b/)?.[1];
  const paramSource = trimmed.match(/\((.*)\)/)?.[1] ?? '';
  const params = splitParams(paramSource).map(cleanParamName).filter(Boolean);
  const throws = /\bthrow\b/.test(trimmed);
  const returns = kind === 'function' && !/\bconstructor\s*\(/.test(trimmed);

  return {
    kind,
    name,
    params,
    returns,
    throws,
  };
}

function splitParams(input: string): string[] {
  if (!input.trim()) return [];
  const params: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of input) {
    if (char === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
      continue;
    }

    if (char === '(' || char === '[' || char === '{' || char === '<') depth += 1;
    if (char === ')' || char === ']' || char === '}' || char === '>')
      depth = Math.max(0, depth - 1);
    current += char;
  }

  if (current.trim()) params.push(current.trim());
  return params;
}

function cleanParamName(param: string): string {
  return param
    .replace(/^\.{3}/, '')
    .replace(/[:=].*$/, '')
    .replace(/\?$/, '')
    .replace(/^\{.*\}$/s, 'options')
    .replace(/^\[.*\]$/s, 'items')
    .trim();
}

function buildJsLikeDoc(
  signature: ReturnType<typeof parseSignature>,
  options: { includeThrows: boolean },
): string {
  const lines = [
    '/**',
    ` * ${signature.name ? `Describe ${signature.name}.` : 'Describe this symbol.'}`,
  ];
  for (const param of signature.params) {
    lines.push(` * @param ${param} - Describe ${param}.`);
  }
  if (signature.returns) {
    lines.push(' * @returns Describe the return value.');
  }
  if (options.includeThrows) {
    lines.push(' * @throws {Error} Describe when this throws.');
  }
  lines.push(' */');
  return lines.join('\n');
}

function buildPythonDoc(
  signature: ReturnType<typeof parseSignature>,
  style: 'numpy' | 'google',
): string {
  if (style === 'numpy') {
    const lines = ['"""Describe this symbol.', ''];
    if (signature.params.length) {
      lines.push('Parameters', '----------');
      for (const param of signature.params) {
        lines.push(`${param} : type`, `    Describe ${param}.`);
      }
      lines.push('');
    }
    if (signature.returns) {
      lines.push('Returns', '-------', 'type', '    Describe the return value.', '');
    }
    lines.push('"""');
    return lines.join('\n');
  }

  const lines = ['"""Describe this symbol.', ''];
  if (signature.params.length) {
    lines.push('Args:');
    for (const param of signature.params) {
      lines.push(`    ${param}: Describe ${param}.`);
    }
    lines.push('');
  }
  if (signature.returns) {
    lines.push('Returns:', '    Describe the return value.', '');
  }
  lines.push('"""');
  return lines.join('\n');
}

function indentDoc(doc: string, indent: string): string {
  return doc
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function nextIndent(indent: string): string {
  return `${indent}    `;
}

function normalizeStyle(style?: string, filePath?: string): DocStyle {
  if (style) {
    const normalized = style.toLowerCase() as DocStyle;
    if (DOC_STYLES.has(normalized)) return normalized;
  }

  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.ts' || ext === '.tsx') return 'tsdoc';
    if (ext === '.py') return 'google';
  }

  return 'jsdoc';
}

function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py') return 'python';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  return 'javascript';
}

function safeReadFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function parseDocArgs(args: string[]): {
  all: boolean;
  overwrite: boolean;
  style?: string;
  file?: string;
  symbol?: string;
  error?: string;
} {
  const positional: string[] = [];
  let all = false;
  let overwrite = false;
  let style: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--overwrite') {
      overwrite = true;
      continue;
    }
    if (arg === '--style') {
      style = args[index + 1];
      index += 1;
      if (!style) {
        return { all, overwrite, error: 'missing value for --style' };
      }
      if (!DOC_STYLES.has(style.toLowerCase() as DocStyle)) {
        return { all, overwrite, error: `unsupported doc style: ${style}` };
      }
      continue;
    }
    positional.push(arg);
  }

  if (all) return { all, overwrite, style };
  return {
    all,
    overwrite,
    style,
    file: positional[0],
    symbol: positional[1],
  };
}

function groupByFile(symbols: UndocumentedSymbol[]): Map<string, UndocumentedSymbol[]> {
  const grouped = new Map<string, UndocumentedSymbol[]>();
  for (const symbol of symbols) {
    const entries = grouped.get(symbol.file) ?? [];
    entries.push(symbol);
    grouped.set(symbol.file, entries);
  }
  return grouped;
}
