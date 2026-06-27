import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type EditFormat = 'whole' | 'diff' | 'udiff';

export interface DiffBlock {
  filePath: string;
  search: string;
  replace: string;
}

export interface ApplyResult {
  filePath: string;
  success: boolean;
  error?: string;
}

interface FileState {
  absPath: string;
  eol: '\n' | '\r\n';
  content: string;
}

const DIFF_BLOCK_PATTERN =
  /<<<<<<< SEARCH\r?\nfilepath:\s*(.+?)\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

export function parseDiffBlocks(content: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];

  for (const match of content.matchAll(DIFF_BLOCK_PATTERN)) {
    const [, filePath = '', search = '', replace = ''] = match;
    const normalizedPath = filePath.trim();
    if (!normalizedPath) continue;
    blocks.push({
      filePath: normalizedPath,
      search: normalizeEol(search),
      replace: normalizeEol(replace),
    });
  }

  return blocks;
}

export function applyDiffBlocks(blocks: DiffBlock[]): ApplyResult[] {
  const results: ApplyResult[] = [];
  const states = new Map<string, FileState>();

  for (const block of blocks) {
    try {
      const state = getFileState(states, block.filePath);
      state.content = applyBlock(state.content, block);
      fs.writeFileSync(state.absPath, restoreEol(state.content, state.eol), 'utf8');
      results.push({ filePath: block.filePath, success: true });
    } catch (error: unknown) {
      results.push({
        filePath: block.filePath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function getFileState(states: Map<string, FileState>, filePath: string): FileState {
  const cached = states.get(filePath);
  if (cached) return cached;

  const absPath = path.resolve(config.cwd, filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(absPath, 'utf8');
  const state: FileState = {
    absPath,
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
    content: normalizeEol(raw),
  };
  states.set(filePath, state);
  return state;
}

function applyBlock(content: string, block: DiffBlock): string {
  if (!block.search.trim()) {
    throw new Error(`search text must not be empty for ${block.filePath}`);
  }

  const exactMatches = findAllOccurrences(content, block.search);
  if (exactMatches.length === 1) {
    const index = exactMatches[0] as number;
    return content.slice(0, index) + block.replace + content.slice(index + block.search.length);
  }
  if (exactMatches.length > 1) {
    throw new Error(`search text matched multiple locations in ${block.filePath}`);
  }

  const fuzzyMatch = findFuzzyMatch(content, block.search);
  if (!fuzzyMatch) {
    throw new Error(`search text not found in ${block.filePath}`);
  }
  if (fuzzyMatch.ambiguous) {
    throw new Error(`search text matched multiple locations in ${block.filePath}`);
  }

  const lines = content.split('\n');
  const replacementLines = splitReplacementLines(block.replace);
  return [
    ...lines.slice(0, fuzzyMatch.startLine),
    ...replacementLines,
    ...lines.slice(fuzzyMatch.endLine),
  ].join('\n');
}

function findAllOccurrences(source: string, target: string): number[] {
  if (!target) return [];

  const matches: number[] = [];
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(target, offset);
    if (index === -1) break;
    matches.push(index);
    offset = index + target.length;
  }
  return matches;
}

function findFuzzyMatch(
  content: string,
  search: string,
): { startLine: number; endLine: number; ambiguous: boolean } | null {
  const fileLines = content.split('\n');
  const searchLines = stripBlankEdges(search.split('\n'));
  if (searchLines.length === 0) return null;

  const normalizedSearch = searchLines.map(normalizeComparableLine);
  const maxExtraLines = Math.max(4, search.split('\n').length - searchLines.length + 4);
  const matches = new Map<string, { startLine: number; endLine: number }>();

  for (let start = 0; start < fileLines.length; start += 1) {
    const minEnd = start + searchLines.length;
    const maxEnd = Math.min(fileLines.length, minEnd + maxExtraLines);
    for (let end = minEnd; end <= maxEnd; end += 1) {
      const candidate = stripBlankEdges(fileLines.slice(start, end));
      if (candidate.length !== normalizedSearch.length) continue;
      const normalizedCandidate = candidate.map(normalizeComparableLine);
      if (normalizedCandidate.every((line, index) => line === normalizedSearch[index])) {
        matches.set(`${start}:${end}`, { startLine: start, endLine: end });
      }
    }
  }

  if (matches.size === 0) return null;
  if (matches.size > 1) {
    const [first] = matches.values();
    return first ? { ...first, ambiguous: true } : null;
  }

  const [match] = matches.values();
  return match ? { ...match, ambiguous: false } : null;
}

function splitReplacementLines(replace: string): string[] {
  if (replace === '') return [];
  return replace.split('\n');
}

function stripBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === '') start += 1;
  while (end > start && lines[end - 1]?.trim() === '') end -= 1;
  return lines.slice(start, end);
}

function normalizeComparableLine(line: string): string {
  return line.replace(/\s+/g, '');
}

function normalizeEol(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function restoreEol(value: string, eol: '\n' | '\r\n'): string {
  return eol === '\n' ? value : value.replace(/\n/g, '\r\n');
}
