import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch, diffLines } from 'diff';
import { theme } from '../ui/theme.js';

export interface CompareStats {
  linesA: number;
  linesB: number;
  additions: number;
  deletions: number;
  unchanged: number;
}

export interface ComparePayload {
  fileA: string;
  fileB: string;
  diff: string;
  prompt: string;
  stats: CompareStats;
}

export function compareFiles(
  pathA: string,
  pathB: string,
  cwd: string,
): ComparePayload | { error: string } {
  const fileA = path.resolve(cwd, pathA);
  const fileB = path.resolve(cwd, pathB);

  const missing = firstMissingFile(fileA, fileB);
  if (missing) {
    return { error: `file not found: ${missing}` };
  }

  try {
    const textA = fs.readFileSync(fileA, 'utf8');
    const textB = fs.readFileSync(fileB, 'utf8');
    const stats = calculateStats(textA, textB);
    const diff = createTwoFilesPatch(pathA, pathB, textA, textB);

    return {
      fileA,
      fileB,
      diff,
      stats,
      prompt: buildPrompt(fileA, fileB, diff, stats),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `compare failed: ${message}` };
  }
}

export function compareCommand(args: string[], cwd: string): string {
  if (args.length !== 2) {
    return `${theme.warn('usage: /compare <file-a> <file-b>')}\n`;
  }

  const result = compareFiles(args[0], args[1], cwd);
  if ('error' in result) {
    return `${theme.err(result.error)}\n`;
  }

  const hasChanges = result.stats.additions > 0 || result.stats.deletions > 0;
  const lines = [
    `${theme.brand('Compare')} ${theme.dim(`${result.fileA} ↔ ${result.fileB}`)}`,
    `  ${theme.hl(`A:${result.stats.linesA}`)}  ${theme.hl(`B:${result.stats.linesB}`)}  ${theme.ok(
      `+${result.stats.additions}`,
    )}  ${theme.err(`-${result.stats.deletions}`)}  ${theme.dim(`=${result.stats.unchanged}`)}`,
    '',
    theme.brand('Unified diff'),
    hasChanges ? formatDiff(result.diff) : theme.dim('No content changes detected.'),
    '',
    theme.brand('AI analysis prompt'),
    result.prompt,
  ];

  return `${lines.join('\n').trimEnd()}\n`;
}

function firstMissingFile(...filePaths: string[]): string | undefined {
  return filePaths.find((filePath) => {
    try {
      return !fs.statSync(filePath).isFile();
    } catch {
      return true;
    }
  });
}

function calculateStats(textA: string, textB: string): CompareStats {
  const stats: CompareStats = {
    linesA: countLines(textA),
    linesB: countLines(textB),
    additions: 0,
    deletions: 0,
    unchanged: 0,
  };

  for (const part of diffLines(textA, textB)) {
    const lines = countLines(part.value);
    if (part.added) {
      stats.additions += lines;
    } else if (part.removed) {
      stats.deletions += lines;
    } else {
      stats.unchanged += lines;
    }
  }

  return stats;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function buildPrompt(fileA: string, fileB: string, diff: string, stats: CompareStats): string {
  return [
    'Analyze the differences between these two files.',
    `File A: ${fileA}`,
    `File B: ${fileB}`,
    'Explain what changed, why those changes likely happened, and whether one version looks better for maintainability, correctness, or clarity.',
    'Use the unified diff and stats below as evidence.',
    '',
    `Stats: linesA=${stats.linesA}, linesB=${stats.linesB}, additions=${stats.additions}, deletions=${stats.deletions}, unchanged=${stats.unchanged}`,
    '',
    diff,
  ].join('\n');
}

function formatDiff(diffText: string): string {
  return diffText
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return theme.hl(line);
      if (line.startsWith('@@') || line.startsWith('===')) return theme.dim(line);
      if (line.startsWith('+')) return theme.ok(line);
      if (line.startsWith('-')) return theme.err(line);
      return line.startsWith(' ') ? theme.dim(line) : line;
    })
    .join('\n');
}
