import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { assertSandbox } from './sandbox.js';

export interface ListDirectoryArgs {
  path: string;
  recursive?: boolean;
  maxDepth?: number;
  pattern?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modified?: string;
}

interface DirNode extends DirEntry {
  children?: DirNode[];
}

const DEFAULT_MAX_DEPTH = 2;
const MAX_ENTRIES = 200;
const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist']);

export const listDirectorySchema: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_directory',
    description:
      'List directory contents as a formatted tree, respecting .gitignore and optional glob filters.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the current working directory.',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to recursively include subdirectories.',
        },
        maxDepth: {
          type: 'number',
          default: DEFAULT_MAX_DEPTH,
          description: 'Maximum nested depth when recursive is enabled.',
        },
        pattern: {
          type: 'string',
          description: 'Optional glob pattern used to filter returned entries.',
        },
      },
      required: ['path'],
    },
  },
};

export async function listDirectory(args: ListDirectoryArgs): Promise<string> {
  try {
    const root = path.resolve(config.cwd, args.path || '.');
    assertSandbox(root, config.cwd);

    if (!fs.existsSync(root)) {
      return `Error: directory not found: ${args.path}`;
    }

    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      return `Error: not a directory: ${args.path}`;
    }

    const recursive = Boolean(args.recursive);
    const maxDepth = recursive ? normalizeMaxDepth(args.maxDepth) : 1;
    const ignorePatterns = readGitignorePatterns(config.cwd);
    const matcher = createPatternMatcher(args.pattern);
    const rootLabel = formatRootLabel(args.path, root);
    const tree = collectEntries(root, root, 1, maxDepth, recursive, ignorePatterns, matcher);
    const totalEntries = countEntries(tree);
    const lines = [`${rootLabel}/`];
    const emitted = { count: 0 };

    renderTree(lines, tree, '', emitted);

    if (totalEntries === 0) {
      lines.push('(empty)');
    } else if (totalEntries > MAX_ENTRIES) {
      lines.push(
        `… truncated ${totalEntries - MAX_ENTRIES} additional entr${totalEntries - MAX_ENTRIES === 1 ? 'y' : 'ies'} (showing first ${MAX_ENTRIES} of ${totalEntries})`,
      );
    }

    return lines.join('\n');
  } catch (e: any) {
    return `Error: ${e?.message || String(e)}`;
  }
}

function collectEntries(
  currentDir: string,
  rootDir: string,
  depth: number,
  maxDepth: number,
  recursive: boolean,
  ignorePatterns: string[],
  matcher: ((relativePath: string, name: string) => boolean) | null,
): DirNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: DirNode[] = [];
  const sorted = entries
    .slice()
    .sort(
      (left, right) =>
        Number(right.isDirectory()) - Number(left.isDirectory()) ||
        left.name.localeCompare(right.name),
    );

  for (const entry of sorted) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativeToRoot = normalizeSlashes(path.relative(rootDir, absolutePath));
    const relativeToCwd = normalizeSlashes(path.relative(config.cwd, absolutePath));
    const isDirectory = entry.isDirectory();

    if (shouldIgnore(relativeToCwd, isDirectory, ignorePatterns)) {
      continue;
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      continue;
    }

    const node: DirNode = {
      name: entry.name,
      path: relativeToCwd || '.',
      type: isDirectory ? 'dir' : 'file',
      size: isDirectory ? undefined : stats.size,
      modified: stats.mtime.toISOString(),
    };

    if (isDirectory && recursive && depth < maxDepth) {
      node.children = collectEntries(
        absolutePath,
        rootDir,
        depth + 1,
        maxDepth,
        recursive,
        ignorePatterns,
        matcher,
      );
    }

    const matches = matcher ? matcher(relativeToRoot, entry.name) : true;
    if (isDirectory) {
      if (matches || (node.children?.length ?? 0) > 0 || !matcher) {
        nodes.push(node);
      }
    } else if (matches) {
      nodes.push(node);
    }
  }

  return nodes;
}

function renderTree(
  lines: string[],
  nodes: DirNode[],
  prefix: string,
  emitted: { count: number },
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    if (emitted.count >= MAX_ENTRIES) {
      return;
    }

    const node = nodes[index];
    const isLast = index === nodes.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    lines.push(`${prefix}${connector}${formatNode(node)}`);
    emitted.count += 1;

    if (node.type === 'dir' && node.children?.length) {
      renderTree(lines, node.children, `${prefix}${isLast ? '   ' : '│  '}`, emitted);
    }
  }
}

function formatNode(node: DirNode): string {
  const details = [
    node.type,
    ...(typeof node.size === 'number' ? [`${node.size} B`] : []),
    ...(node.modified ? [`modified ${node.modified}`] : []),
  ];
  return `${node.name}${node.type === 'dir' ? '/' : ''} [${details.join(', ')}]`;
}

function formatRootLabel(inputPath: string, absolutePath: string): string {
  if (!inputPath || inputPath === '.') return '.';
  const relative = path.relative(config.cwd, absolutePath);
  return relative ? normalizeSlashes(relative) : '.';
}

function countEntries(nodes: DirNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countEntries(node.children ?? []), 0);
}

function normalizeMaxDepth(maxDepth: number | undefined): number {
  if (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth)) {
    return DEFAULT_MAX_DEPTH;
  }
  return Math.max(1, Math.floor(maxDepth));
}

function readGitignorePatterns(cwd: string): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    return fs
      .readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
  } catch {
    return [];
  }
}

function shouldIgnore(relativePath: string, isDirectory: boolean, patterns: string[]): boolean {
  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }

  const normalized = normalizeSlashes(relativePath);
  const segments = normalized.split('/');
  if (segments.some((segment) => DEFAULT_IGNORES.has(segment))) {
    return true;
  }

  return patterns.some((pattern) =>
    matchesGitignorePattern(normalized, segments, isDirectory, pattern),
  );
}

function matchesGitignorePattern(
  normalizedPath: string,
  segments: string[],
  isDirectory: boolean,
  pattern: string,
): boolean {
  const normalizedPattern = normalizeSlashes(pattern).replace(/^\/+/, '');
  const directoryOnly = normalizedPattern.endsWith('/');
  const barePattern = normalizedPattern.replace(/\/+$/, '');

  if (directoryOnly && !isDirectory && barePattern === normalizedPath) {
    return false;
  }

  if (!barePattern) {
    return false;
  }

  if (!hasGlob(barePattern) && !barePattern.includes('/')) {
    return segments.includes(barePattern);
  }

  if (!hasGlob(barePattern)) {
    return normalizedPath === barePattern || normalizedPath.startsWith(`${barePattern}/`);
  }

  const regex = globToRegExp(barePattern);
  return regex.test(normalizedPath);
}

function createPatternMatcher(
  pattern: string | undefined,
): ((relativePath: string, name: string) => boolean) | null {
  if (!pattern?.trim()) {
    return null;
  }

  const normalizedPattern = normalizeSlashes(pattern.trim());
  const hasSlash = normalizedPattern.includes('/');
  const regex = globToRegExp(normalizedPattern);
  return (relativePath: string, name: string) => regex.test(hasSlash ? relativePath : name);
}

function hasGlob(value: string): boolean {
  return /[*?[\]]/.test(value);
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[|\\{}()[\]^$+.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${source}$`);
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}
