import simpleGit from 'simple-git';
import { theme } from '../ui/theme.js';

export interface LogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

interface ParsedArgs {
  count: number;
  author?: string;
  since?: string;
  branch?: string;
}

interface GitLogLine {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  refs: string;
}

const DEFAULT_COUNT = 15;
const MAX_COUNT = 100;
const USAGE = 'Usage: /git-log [--count <n>|-n <n>] [--author <name>] [--since <date>] [branch]';

export async function gitLogCommand(args: string[], cwd: string): Promise<string> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    return `${theme.warn((error as Error).message)}\n`;
  }

  const git = simpleGit({ baseDir: cwd });

  try {
    if (!(await git.checkIsRepo())) {
      return `${theme.warn(`Not a git repository: ${cwd}`)}\n`;
    }

    const logArgs = [`--max-count=${parsed.count}`];
    if (parsed.author) logArgs.push(`--author=${parsed.author}`);
    if (parsed.since) logArgs.push(`--since=${parsed.since}`);
    if (parsed.branch) logArgs.push(parsed.branch);

    const result = await git.log<GitLogLine>(logArgs);
    if (result.all.length === 0) return `${theme.dim('No commits found.')}\n`;

    const entries = result.all.map(toLogEntry);
    return `${entries.map(formatLogEntry).join('\n')}\n`;
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return `${theme.warn(`Not a git repository: ${cwd}`)}\n`;
    }
    return `${theme.err(`git log failed: ${(error as Error).message}`)}\n`;
  }
}

export function formatLogEntry(entry: LogEntry): string {
  const refs = entry.refs.length > 0 ? ` ${theme.hl(`(${entry.refs.join(', ')})`)}` : '';
  return `${theme.dim(entry.shortHash)} ${entry.subject} ${theme.user(entry.author)} ${theme.dim(entry.date)}${refs}`;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { count: DEFAULT_COUNT };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--count' || arg === '-n') {
      const rawCount = args[++i];
      const count = Number.parseInt(rawCount ?? '', 10);
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error(USAGE);
      }
      parsed.count = Math.min(count, MAX_COUNT);
      continue;
    }

    if (arg === '--author') {
      const author = args[++i]?.trim();
      if (!author) throw new Error(USAGE);
      parsed.author = author;
      continue;
    }

    if (arg === '--since') {
      const since = args[++i]?.trim();
      if (!since) throw new Error(USAGE);
      parsed.since = since;
      continue;
    }

    if (arg.startsWith('-')) throw new Error(USAGE);
    if (parsed.branch) throw new Error(USAGE);

    parsed.branch = arg;
  }

  return parsed;
}

function toLogEntry(entry: GitLogLine): LogEntry {
  return {
    hash: entry.hash,
    shortHash: entry.hash.slice(0, 7),
    subject: entry.message,
    author: entry.author_name,
    date: entry.date,
    refs: parseRefs(entry.refs),
  };
}

function parseRefs(refs: string): string[] {
  if (!refs.trim()) return [];
  return refs
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function isNotGitRepositoryError(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message);
}
