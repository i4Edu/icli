import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { assertSandbox } from './sandbox.js';

export type SearchSymbolKind = 'function' | 'class' | 'variable' | 'interface' | 'type';
export type SearchSymbolFilter = SearchSymbolKind | 'all';

export interface SearchSymbolsArgs {
  query: string;
  filePattern?: string;
  type?: SearchSymbolFilter;
}

export interface SearchSymbolResult {
  name: string;
  type: SearchSymbolKind;
  file: string;
  line: number;
  signature: string;
}

type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

interface SymbolPattern {
  type: SearchSymbolKind;
  regex: RegExp;
}

const RESULT_LIMIT = 50;
const DEFAULT_FILE_PATTERNS = [
  '**/*.{ts,tsx,mts,cts}',
  '**/*.{js,jsx,mjs,cjs}',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
] as const;

const PATTERN_LIBRARY: Record<Language, SymbolPattern[]> = {
  typescript: [
    { type: 'function', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'class', regex: /^\s*(?:export\s+)?(?:default\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'interface', regex: /^\s*(?:export\s+)?(?:default\s+)?interface\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'type', regex: /^\s*(?:export\s+)?type\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'variable', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
  ],
  javascript: [
    { type: 'function', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'class', regex: /^\s*(?:export\s+)?(?:default\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
    { type: 'variable', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\b/ },
  ],
  python: [
    { type: 'function', regex: /^\s*def\s+(?<name>[A-Za-z_][\w]*)\b/ },
    { type: 'class', regex: /^\s*class\s+(?<name>[A-Za-z_][\w]*)\b/ },
    { type: 'variable', regex: /^(?<name>[A-Za-z_][\w]*)\s*(?::[^=]+)?=/ },
  ],
  go: [
    { type: 'function', regex: /^\s*func\s*(?:\([^)]*\)\s*)?(?<name>[A-Za-z_][\w]*)\s*\(/ },
    { type: 'interface', regex: /^\s*type\s+(?<name>[A-Za-z_][\w]*)\s+interface\b/ },
    { type: 'type', regex: /^\s*type\s+(?<name>[A-Za-z_][\w]*)\s+(?!interface\b).+/ },
    { type: 'variable', regex: /^\s*(?:var|const)\s+(?<name>[A-Za-z_][\w]*)\b/ },
  ],
  rust: [
    { type: 'function', regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(?<name>[A-Za-z_][\w]*)\b/ },
    { type: 'interface', regex: /^\s*(?:pub\s+)?trait\s+(?<name>[A-Za-z_][\w]*)\b/ },
    { type: 'type', regex: /^\s*(?:pub\s+)?(?:struct|enum|type)\s+(?<name>[A-Za-z_][\w]*)\b/ },
    { type: 'variable', regex: /^\s*(?:pub\s+)?(?:const|static)\s+(?:mut\s+)?(?<name>[A-Za-z_][\w]*)\b/ },
  ],
};

export const searchSymbolsSchema: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_symbols',
    description: 'Search source files for symbol declarations matching a regex query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Regular expression used to match symbol names or declaration signatures.',
        },
        filePattern: {
          type: 'string',
          description: 'Optional fast-glob file pattern to narrow the search scope.',
        },
        type: {
          type: 'string',
          enum: ['function', 'class', 'variable', 'interface', 'type', 'all'],
          description: 'Optional symbol kind filter.',
        },
      },
      required: ['query'],
    },
  },
};

export async function searchSymbols(args: SearchSymbolsArgs): Promise<string> {
  const root = path.resolve(config.cwd);
  assertSandbox(root, config.cwd);

  const query = compileQuery(args.query);
  const typeFilter = args.type ?? 'all';
  const files = await fg(args.filePattern ? [args.filePattern] : [...DEFAULT_FILE_PATTERNS], {
    cwd: root,
    onlyFiles: true,
    dot: false,
    unique: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', ...loadGitIgnorePatterns(root)],
  });

  const results: SearchSymbolResult[] = [];
  for (const file of files) {
    if (results.length >= RESULT_LIMIT) break;

    const language = detectLanguage(file);
    if (!language) continue;

    const matches = searchFile(path.join(root, file), path.relative(config.cwd, path.join(root, file)), language, query, typeFilter);
    for (const match of matches) {
      results.push(match);
      if (results.length >= RESULT_LIMIT) break;
    }
  }

  return JSON.stringify(results);
}

function searchFile(
  absoluteFile: string,
  relativeFile: string,
  language: Language,
  query: RegExp,
  typeFilter: SearchSymbolFilter,
): SearchSymbolResult[] {
  let content: string;
  try {
    content = fs.readFileSync(absoluteFile, 'utf8');
  } catch {
    return [];
  }

  const patterns = PATTERN_LIBRARY[language];
  const results: SearchSymbolResult[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const pattern of patterns) {
      if (typeFilter !== 'all' && pattern.type !== typeFilter) continue;
      const match = pattern.regex.exec(line);
      const name = match?.groups?.name;
      if (!name) continue;

      const signature = line.trim();
      if (!query.test(name) && !query.test(signature)) continue;

      results.push({
        name,
        type: pattern.type,
        file: relativeFile,
        line: index + 1,
        signature,
      });
      break;
    }
  }

  return results;
}

function compileQuery(query: string): RegExp {
  try {
    return new RegExp(query);
  } catch {
    return new RegExp(escapeRegex(query));
  }
}

function detectLanguage(file: string): Language | null {
  const extension = path.extname(file).toLowerCase();
  switch (extension) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadGitIgnorePatterns(root: string): string[] {
  const gitIgnorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(gitIgnorePath)) return [];

  try {
    return fs
      .readFileSync(gitIgnorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))
      .flatMap((line) => {
        const normalized = line.replace(/^\.\//, '').replace(/^\/+/, '');
        if (normalized.endsWith('/')) return [normalized, `${normalized}**`];
        return [normalized];
      });
  } catch {
    return [];
  }
}
