import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

const AI_COMMITS_ENV = 'ICOPILOT_AI_COMMITS_PATH';
const AI_COMMITS_LIMIT = 200;

interface AiCommitState {
  commits: string[];
}

interface CommitDetails {
  sha: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  files: string[];
}

export interface GitUndoOptions {
  cwd?: string;
  hard?: boolean;
}

function git(cwd = config.cwd): SimpleGit {
  return simpleGit({ baseDir: cwd });
}

export function aiCommitsPath(): string {
  return process.env[AI_COMMITS_ENV] || path.join(os.homedir(), '.icopilot', 'ai-commits.json');
}

function ensureStateDir(): void {
  fs.mkdirSync(path.dirname(aiCommitsPath()), { recursive: true });
}

function emptyState(): AiCommitState {
  return { commits: [] };
}

function normalizeState(candidate: unknown): AiCommitState {
  if (!candidate || typeof candidate !== 'object') return emptyState();
  const parsed = candidate as Partial<AiCommitState>;
  return {
    commits: Array.isArray(parsed.commits)
      ? parsed.commits.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
  };
}

function loadState(): AiCommitState {
  ensureStateDir();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(aiCommitsPath(), 'utf8')));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    return emptyState();
  }
}

function saveState(state: AiCommitState): void {
  ensureStateDir();
  fs.writeFileSync(aiCommitsPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizeSha(sha: string): string {
  return sha.trim().toLowerCase();
}

function matchesCommitSha(left: string, right: string): boolean {
  const a = normalizeSha(left);
  const b = normalizeSha(right);
  return Boolean(a) && Boolean(b) && (a === b || a.startsWith(b) || b.startsWith(a));
}

export function registerAiCommit(sha: string): void {
  const normalized = normalizeSha(sha);
  if (!normalized) return;
  const state = loadState();
  state.commits = state.commits.filter((entry) => !matchesCommitSha(entry, normalized));
  state.commits.push(normalized);
  state.commits = state.commits.slice(Math.max(0, state.commits.length - AI_COMMITS_LIMIT));
  saveState(state);
}

function unregisterAiCommit(sha: string): void {
  const state = loadState();
  const next = state.commits.filter((entry) => !matchesCommitSha(entry, sha));
  if (next.length === state.commits.length) return;
  saveState({ commits: next });
}

function isTrackedAiCommit(sha: string): boolean {
  return loadState().commits.some((entry) => matchesCommitSha(entry, sha));
}

function looksLikeAiCommit(details: CommitDetails): boolean {
  const haystack = `${details.subject}\n${details.body}\n${details.authorName}\n${details.authorEmail}`;
  return /\bicopilot\b/i.test(haystack) || /\bcopilot\b/i.test(haystack);
}

async function loadHeadCommitDetails(g: SimpleGit): Promise<CommitDetails> {
  const metaRaw = await g.raw(['show', '-s', '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B', 'HEAD']);
  const [sha = '', subject = '', authorName = '', authorEmail = '', ...bodyParts] = metaRaw.split('\x1f');
  const filesRaw = await g.raw(['show', '--pretty=format:', '--name-only', 'HEAD']);
  return {
    sha: sha.trim(),
    subject: subject.trim(),
    body: bodyParts.join('\x1f').trim(),
    authorName: authorName.trim(),
    authorEmail: authorEmail.trim(),
    files: filesRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function formatUndoSummary(details: CommitDetails, hard: boolean): string {
  const files = details.files.length
    ? details.files.map((file) => `  ${theme.dim('•')} ${file}`).join('\n')
    : `  ${theme.dim('• no file list available')}`;
  return (
    `${theme.ok(`✔ undid AI commit ${details.sha.slice(0, 7)}`)} ${details.subject}\n` +
    `${theme.dim(hard ? 'mode: hard reset (changes discarded)' : 'mode: soft reset (changes kept staged)')}\n` +
    `${theme.brand('Files')}\n${files}\n`
  );
}

function formatSafetyRefusal(details: CommitDetails): string {
  return theme.warn(
    `Refusing to undo ${details.sha.slice(0, 7)} (${details.subject}) because it is not marked as an AI commit.\n`,
  );
}

export async function gitUndo(options: GitUndoOptions = {}): Promise<string> {
  const g = git(options.cwd);
  try {
    const isRepo = await g.checkIsRepo();
    if (!isRepo) return theme.warn('Not a git repository.\n');
    try {
      await g.raw(['rev-parse', '--verify', 'HEAD']);
    } catch {
      return theme.warn('No commits to undo.\n');
    }

    const details = await loadHeadCommitDetails(g);
    const isAiCommit = isTrackedAiCommit(details.sha) || looksLikeAiCommit(details);
    if (!isAiCommit) return formatSafetyRefusal(details);

    try {
      await g.raw(['rev-parse', '--verify', 'HEAD~1']);
    } catch {
      return theme.warn('Cannot undo the initial commit safely.\n');
    }

    await g.raw(['reset', options.hard ? '--hard' : '--soft', 'HEAD~1']);
    unregisterAiCommit(details.sha);
    return formatUndoSummary(details, Boolean(options.hard));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository/i.test(message)) return theme.warn('Not a git repository.\n');
    return theme.err(`git undo failed: ${message}\n`);
  }
}
