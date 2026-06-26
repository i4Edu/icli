import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface ExplainPayload {
  kind: 'file' | 'dir' | 'missing';
  path: string;
  preview: string;
  prompt: string;
}

const DEFAULT_MAX_BYTES = 32_000;
const DEFAULT_MAX_FILES = 25;
const SKIP_NAMES = new Set(['node_modules', '.git', 'dist']);

function readFilePreview(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function buildDirPreview(dirPath: string, maxFiles: number): string {
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !SKIP_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const immediate = entries.map((entry) => `- ${entry.name}${entry.isDirectory() ? '/' : ''}`);
  const files = fg.sync('**/*', {
    cwd: dirPath,
    onlyFiles: true,
    dot: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    deep: 1,
    unique: true,
  });

  const topFiles = files
    .sort((a, b) => a.localeCompare(b))
    .slice(0, Math.max(0, maxFiles))
    .map((file) => `  - ${file}`);

  return [`# Entries`, ...immediate, '', `# Top-level files`, ...topFiles].join('\n').trim();
}

export function buildExplain(
  target: string,
  cwd: string,
  opts: { maxBytes?: number; maxFiles?: number } = {},
): ExplainPayload {
  const resolvedPath = path.resolve(cwd, target);
  let stat: fs.Stats;

  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return {
      kind: 'missing',
      path: resolvedPath,
      preview: '',
      prompt: `Explain request for ${resolvedPath}: the path doesn't exist. Suggest what to check next.`,
    };
  }

  if (stat.isFile()) {
    const preview = readFilePreview(resolvedPath, opts.maxBytes ?? DEFAULT_MAX_BYTES);
    return {
      kind: 'file',
      path: resolvedPath,
      preview,
      prompt:
        `Give a concise structured overview of this file (${resolvedPath}) in <= 200 words. ` +
        `Cover purpose, key exports, and notable risks.\n\n${preview}`,
    };
  }

  if (stat.isDirectory()) {
    const preview = buildDirPreview(resolvedPath, opts.maxFiles ?? DEFAULT_MAX_FILES);
    return {
      kind: 'dir',
      path: resolvedPath,
      preview,
      prompt:
        `Give an architectural summary of this folder (${resolvedPath}). ` +
        `Explain the apparent responsibilities, important files, and likely extension points.\n\n${preview}`,
    };
  }

  return {
    kind: 'missing',
    path: resolvedPath,
    preview: '',
    prompt: `Explain request for ${resolvedPath}: the path doesn't exist. Suggest what to check next.`,
  };
}
