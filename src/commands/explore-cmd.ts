import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface ExploreResult {
  files: string[];
  summary: string;
  tokensCost: number;
}

export interface ExploreOptions {
  query: string;
  cwd: string;
  maxFiles: number;
  maxDepth: number;
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_FILES = 200;
const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist']);

export function buildExplorePrompt(
  query: string,
  cwd: string,
): { prompt: string; context: string } {
  const resolvedCwd = path.resolve(cwd);
  const context = [
    `Workspace: ${resolvedCwd}`,
    '',
    'File tree (depth <= 3, capped at 200 files):',
    gatherProjectContext(resolvedCwd, DEFAULT_MAX_DEPTH),
    '',
    'Project metadata:',
    readProjectMetadata(resolvedCwd),
    '',
    'README snippet:',
    readReadmeSnippet(resolvedCwd),
    '',
    'Git status:',
    readGitStatus(resolvedCwd),
  ].join('\n');

  const prompt = [
    'You are Explore, a lightweight codebase exploration agent.',
    'Answer the user question using only the supplied project context.',
    'Focus on architecture, likely file locations, relevant entry points, and practical next files to inspect.',
    'When you mention files, use repo-relative paths.',
    'If the context is incomplete, say what is missing instead of inventing details.',
    '',
    `User question: ${query.trim()}`,
    '',
    'Project context:',
    context,
  ].join('\n');

  return { prompt, context };
}

export function gatherProjectContext(cwd: string, maxDepth = DEFAULT_MAX_DEPTH): string {
  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
    return '(workspace not found)';
  }

  const ignorePatterns = readGitignorePatterns(resolvedCwd);
  const lines: string[] = ['.'];
  let fileCount = 0;
  let truncated = false;

  const walk = (dirPath: string, depth: number, indent: string): void => {
    if (truncated || depth > maxDepth) return;

    const entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter(
        (entry) =>
          !shouldIgnore(
            path.relative(resolvedCwd, path.join(dirPath, entry.name)),
            entry.isDirectory(),
            ignorePatterns,
          ),
      )
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    for (const entry of entries) {
      if (truncated) break;
      const childPath = path.join(dirPath, entry.name);
      const label = `${indent}${entry.name}${entry.isDirectory() ? '/' : ''}`;
      lines.push(label);

      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          walk(childPath, depth + 1, `${indent}  `);
        }
        continue;
      }

      fileCount += 1;
      if (fileCount >= DEFAULT_MAX_FILES) {
        truncated = true;
      }
    }
  };

  walk(resolvedCwd, 1, '  ');

  if (truncated) {
    lines.push(`  … truncated after ${DEFAULT_MAX_FILES} files`);
  }

  return lines.join('\n');
}

export function exploreCommand(args: string[], cwd: string): string {
  const query = args.join(' ').trim();
  if (!query) {
    return 'usage: /explore <question>\n';
  }

  return buildExplorePrompt(query, cwd).prompt;
}

function readProjectMetadata(cwd: string): string {
  const sections: string[] = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    sections.push(formatPackageJson(packageJsonPath));
  }

  const cargoTomlPath = path.join(cwd, 'Cargo.toml');
  if (fs.existsSync(cargoTomlPath)) {
    sections.push(formatSnippet('Cargo.toml', cargoTomlPath, 20));
  }

  const goModPath = path.join(cwd, 'go.mod');
  if (fs.existsSync(goModPath)) {
    sections.push(formatSnippet('go.mod', goModPath, 20));
  }

  if (!sections.length) {
    return '(no package.json, Cargo.toml, or go.mod found)';
  }

  return sections.join('\n\n');
}

function formatPackageJson(packageJsonPath: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const scripts = Object.keys(raw.scripts ?? {}).sort((a, b) => a.localeCompare(b));
    const deps = Object.keys(raw.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
    const devDeps = Object.keys(raw.devDependencies ?? {}).sort((a, b) => a.localeCompare(b));

    return [
      'package.json:',
      `  name: ${raw.name ?? '(unknown)'}`,
      `  type: ${raw.type ?? '(unspecified)'}`,
      `  scripts: ${scripts.length ? scripts.join(', ') : '(none)'}`,
      `  dependencies (${deps.length}): ${deps.slice(0, 12).join(', ') || '(none)'}`,
      `  devDependencies (${devDeps.length}): ${devDeps.slice(0, 12).join(', ') || '(none)'}`,
    ].join('\n');
  } catch {
    return 'package.json:\n  (failed to parse)';
  }
}

function readReadmeSnippet(cwd: string): string {
  const readmeNames = ['README.md', 'README', 'readme.md', 'readme'];
  const readmePath = readmeNames
    .map((name) => path.join(cwd, name))
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

  if (!readmePath) {
    return '(no README found)';
  }

  try {
    const snippet = fs.readFileSync(readmePath, 'utf8').slice(0, 1_500).trim();
    return snippet || '(README is empty)';
  } catch {
    return '(failed to read README)';
  }
}

function readGitStatus(cwd: string): string {
  try {
    const output = execFileSync('git', ['status', '--short', '--branch'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return output || '(clean working tree)';
  } catch {
    return '(not a git repository or git status unavailable)';
  }
}

function formatSnippet(label: string, filePath: string, maxLines: number): string {
  try {
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .slice(0, maxLines)
      .join('\n')
      .trim();
    return `${label}:\n${lines || '(empty)'}`;
  } catch {
    return `${label}:\n(failed to read)`;
  }
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
  return new RegExp(`^${source}(?:/.*)?$`);
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}
