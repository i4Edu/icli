import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import { config } from '../config.js';

export interface SmartFileOptions {
  maxFiles?: number;
  includeTests?: boolean;
  preferRecent?: boolean;
  filePattern?: string;
}

export interface SelectedFile {
  path: string;
  score: number;
  reason: string;
}

interface CandidateFile {
  path: string;
  size: number;
  mtimeMs: number;
}

const DEFAULT_MAX_FILES = 10;
const SMALL_FILE_BYTES = 16 * 1024;
const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vitest']);
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'by',
  'file',
  'find',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'relevant',
  'show',
  'the',
  'to',
  'with',
]);
const SHORT_KEYWORDS = new Set(['c', 'go', 'js', 'md', 'py', 'ts']);

const EXTENSION_KEYWORDS: Array<{ extensions: string[]; keywords: string[] }> = [
  { extensions: ['.ts', '.mts', '.cts'], keywords: ['ts', 'typescript', 'type-safe'] },
  { extensions: ['.tsx'], keywords: ['tsx', 'react', 'component', 'typescript'] },
  { extensions: ['.js', '.mjs', '.cjs'], keywords: ['js', 'javascript', 'node'] },
  { extensions: ['.json'], keywords: ['json', 'config', 'configuration', 'manifest'] },
  { extensions: ['.md'], keywords: ['docs', 'documentation', 'markdown', 'md', 'readme'] },
  { extensions: ['.yml', '.yaml'], keywords: ['workflow', 'yaml', 'yml', 'config'] },
];

export class SmartFileSelector {
  constructor(private readonly cwd = config.cwd) {}

  async selectRelevant(query: string, options: SmartFileOptions = {}): Promise<SelectedFile[]> {
    const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
    const keywords = extractKeywords(query);
    const normalizedQuery = normalizeForMatch(query);
    if (!keywords.length && !normalizedQuery) {
      return [];
    }

    const candidates = await collectCandidateFiles(this.cwd, options);
    if (!candidates.length) {
      return [];
    }

    const recentPaths =
      options.preferRecent === false ? new Set<string>() : await getRecentPaths(this.cwd);
    const fallbackRecentPaths =
      recentPaths.size || options.preferRecent === false
        ? new Set<string>()
        : getFallbackRecentPaths(candidates, maxFiles);

    return candidates
      .map((candidate) =>
        scoreCandidate(candidate, keywords, normalizedQuery, recentPaths, fallbackRecentPaths),
      )
      .filter((candidate): candidate is SelectedFile => candidate !== null)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, maxFiles);
  }
}

async function collectCandidateFiles(
  cwd: string,
  options: SmartFileOptions,
): Promise<CandidateFile[]> {
  const gitignoreRules = readGitignoreRules(cwd);
  const matcher = options.filePattern ? createGlobMatcher(options.filePattern) : null;
  const candidates: CandidateFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(dir, entry.name);
        const relativePath = normalizeSlashes(path.relative(cwd, absolutePath));
        if (!relativePath) {
          return;
        }

        if (shouldIgnore(relativePath, entry.isDirectory(), gitignoreRules)) {
          return;
        }

        if (entry.isDirectory()) {
          await walk(absolutePath);
          return;
        }

        if (!entry.isFile()) {
          return;
        }

        if (!options.includeTests && isTestFile(relativePath)) {
          return;
        }

        if (matcher && !matcher.test(relativePath)) {
          return;
        }

        try {
          const stats = await fs.promises.stat(absolutePath);
          candidates.push({ path: relativePath, size: stats.size, mtimeMs: stats.mtimeMs });
        } catch {
          // Ignore unreadable files.
        }
      }),
    );
  }

  await walk(cwd);
  return candidates;
}

function scoreCandidate(
  candidate: CandidateFile,
  keywords: string[],
  normalizedQuery: string,
  recentPaths: Set<string>,
  fallbackRecentPaths: Set<string>,
): SelectedFile | null {
  const normalizedPath = normalizeForMatch(candidate.path);
  const ext = path.extname(candidate.path).toLowerCase();
  const fileName = path.basename(candidate.path);
  const normalizedFileName = normalizeForMatch(fileName);
  const normalizedBaseName = normalizeForMatch(path.basename(candidate.path, ext));
  const componentTokens = new Set(splitComponents(candidate.path));
  const reasons: string[] = [];
  let score = 0;

  const exactMatchTerms = [normalizedQuery, ...keywords].filter(Boolean);
  const baseNameTokens = normalizedBaseName.split('-').filter(Boolean);
  const exactMatch =
    exactMatchTerms.some((term) => normalizedFileName === term || normalizedBaseName === term) ||
    (baseNameTokens.length > 0 && baseNameTokens.every((token) => keywords.includes(token)));
  if (exactMatch) {
    score += 10;
    reasons.push('exact filename match');
  }

  const matchedPathKeywords = keywords.filter((keyword) => {
    if (componentTokens.has(keyword)) {
      return true;
    }
    return normalizedPath.includes(keyword);
  });
  if (matchedPathKeywords.length) {
    score += 5;
    reasons.push(`path component match (${unique(matchedPathKeywords).join(', ')})`);
  }

  if (isExtensionRelevant(ext, candidate.path, keywords)) {
    score += 3;
    reasons.push(`extension relevance (${ext || 'no extension'})`);
  }

  if (recentPaths.has(candidate.path) || fallbackRecentPaths.has(candidate.path)) {
    score += 2;
    reasons.push('recently modified');
  }

  if (candidate.size <= SMALL_FILE_BYTES) {
    score += 1;
    reasons.push('small file bonus');
  }

  return score > 0 ? { path: candidate.path, score, reason: reasons.join('; ') } : null;
}

async function getRecentPaths(cwd: string): Promise<Set<string>> {
  try {
    const git = simpleGit({ baseDir: cwd });
    const output = await git.raw(['log', '-n', '1', '--name-only', '--format=']);
    return new Set(
      output
        .split(/\r?\n/)
        .map((line) => normalizeSlashes(line.trim()))
        .filter(Boolean),
    );
  } catch {
    return new Set<string>();
  }
}

function getFallbackRecentPaths(candidates: CandidateFile[], maxFiles: number): Set<string> {
  const count = Math.min(candidates.length, Math.max(maxFiles, 3));
  return new Set(
    [...candidates]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, count)
      .map((candidate) => candidate.path),
  );
}

function readGitignoreRules(cwd: string): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    return fs
      .readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function shouldIgnore(relativePath: string, isDirectory: boolean, rules: string[]): boolean {
  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }

  const normalizedPath = normalizeSlashes(relativePath);
  const segments = normalizedPath.split('/');
  if (segments.some((segment) => DEFAULT_IGNORES.has(segment))) {
    return true;
  }

  let ignored = false;
  for (const rawRule of rules) {
    const negated = rawRule.startsWith('!');
    const rule = negated ? rawRule.slice(1) : rawRule;
    if (!rule) {
      continue;
    }
    if (matchesGitignoreRule(normalizedPath, segments, isDirectory, rule)) {
      ignored = !negated;
    }
  }

  return ignored;
}

function matchesGitignoreRule(
  normalizedPath: string,
  segments: string[],
  isDirectory: boolean,
  rule: string,
): boolean {
  const normalizedRule = normalizeSlashes(rule).replace(/^\/+/, '');
  const directoryOnly = normalizedRule.endsWith('/');
  const bareRule = normalizedRule.replace(/\/+$/, '');
  if (!bareRule) {
    return false;
  }

  if (directoryOnly && !isDirectory && bareRule === normalizedPath) {
    return false;
  }

  if (!hasGlob(bareRule) && !bareRule.includes('/')) {
    return segments.includes(bareRule);
  }

  if (!hasGlob(bareRule)) {
    return normalizedPath === bareRule || normalizedPath.startsWith(`${bareRule}/`);
  }

  return createGlobMatcher(bareRule).test(normalizedPath);
}

function createGlobMatcher(pattern: string): RegExp {
  const normalizedPattern = normalizeSlashes(pattern).replace(/^\/+/, '');
  const source = normalizedPattern
    .replace(/[|\\{}()[\]^$+.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${source}$`, 'i');
}

function hasGlob(value: string): boolean {
  return /[*?[\]]/.test(value);
}

function extractKeywords(query: string): string[] {
  return unique(
    query
      .toLowerCase()
      .split(/[^a-z0-9.\-_]+/)
      .map((part) => normalizeForMatch(part))
      .filter((part) => {
        if (!part) return false;
        if (STOP_WORDS.has(part)) return false;
        return part.length > 1 || SHORT_KEYWORDS.has(part);
      }),
  );
}

function isExtensionRelevant(ext: string, filePath: string, keywords: string[]): boolean {
  const lowerPath = filePath.toLowerCase();
  if (
    keywords.some(
      (keyword) =>
        keyword === ext.replace(/^\./, '') || keyword === lowerPath.split('.').slice(1).join('.'),
    )
  ) {
    return true;
  }

  return EXTENSION_KEYWORDS.some((entry) => {
    return (
      entry.extensions.includes(ext) &&
      entry.keywords.some((keyword) => keywords.includes(normalizeForMatch(keyword)))
    );
  });
}

function isTestFile(filePath: string): boolean {
  const normalizedPath = normalizeSlashes(filePath).toLowerCase();
  return (
    normalizedPath.includes('/tests/') ||
    normalizedPath.includes('/__tests__/') ||
    /(?:^|\/)[^.]+\.(test|spec)\.[^/]+$/.test(normalizedPath)
  );
}

function splitComponents(filePath: string): string[] {
  return unique(
    normalizeSlashes(filePath)
      .toLowerCase()
      .split(/[/.\-_]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
