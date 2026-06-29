import { execSync } from 'node:child_process';
import { config } from '../config.js';

export interface GitContextOptions {
  commits?: number;
  since?: string;
  author?: string;
  paths?: string[];
}

export interface GitFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  diff?: string;
}

export interface BlameInfo {
  author: string;
  date: string;
  commit: string;
  message: string;
}

const DEFAULT_RECENT_COMMITS = 5;
const DEFAULT_CONTEXT_LIMIT = 8;
const MAX_DIFF_CHARS = 4_000;

export class GitContextProvider {
  constructor(private readonly cwd = config.cwd) {}

  async getRecentlyModified(options: GitContextOptions = {}): Promise<GitFile[]> {
    if (!this.isRepository()) return [];

    const args = [
      'log',
      '--name-status',
      '--format=format:',
      `-n ${Math.max(1, options.commits ?? DEFAULT_RECENT_COMMITS)}`,
    ];
    if (options.since) args.push(`--since=${quote(options.since)}`);
    if (options.author) args.push(`--author=${quote(options.author)}`);
    if (options.paths?.length) args.push(`-- ${options.paths.map(quote).join(' ')}`);

    const output = this.runGit(args.join(' '));
    return dedupeGitFiles(parseNameStatusOutput(output));
  }

  async getStagedFiles(): Promise<GitFile[]> {
    return this.getDiffFiles('--cached');
  }

  async getUnstagedFiles(): Promise<GitFile[]> {
    if (!this.isRepository()) return [];

    const output = this.runGit('status --porcelain=v1');
    const files = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .flatMap((line) => parsePorcelainLine(line, 'unstaged'));

    return Promise.resolve(
      dedupeGitFiles(
        files.map((file) => ({
          ...file,
          diff: file.status === 'added' ? undefined : this.getFileDiff('', file.path),
        })),
      ),
    );
  }

  async getBranchDiff(base?: string): Promise<GitFile[]> {
    if (!this.isRepository()) return [];
    const resolvedBase = base || this.detectBaseBranch();
    const range = `${resolvedBase}...HEAD`;
    const output = this.runGit(`diff --name-status ${quote(range)}`);
    const files = parseNameStatusOutput(output).map((file) => ({
      ...file,
      diff: this.getFileDiff(quote(range), file.path),
    }));
    return dedupeGitFiles(files);
  }

  async getBlameContext(file: string, line: number): Promise<BlameInfo> {
    if (!this.isRepository()) {
      throw new Error(`Not a git repository: ${this.cwd}`);
    }

    const safeLine = Math.max(1, Math.floor(line));
    const output = this.runGit(`blame -L ${safeLine},${safeLine} --porcelain -- ${quote(file)}`);
    return parseBlameOutput(output);
  }

  async getSessionContextFiles(): Promise<GitFile[]> {
    if (!this.isRepository()) return [];

    const [staged, unstaged, branchDiff] = await Promise.all([
      this.getStagedFiles(),
      this.getUnstagedFiles(),
      this.getBranchDiff().catch(() => []),
    ]);

    const merged = dedupeGitFiles([...staged, ...unstaged, ...branchDiff]).slice(
      0,
      DEFAULT_CONTEXT_LIMIT,
    );

    if (merged.length > 0) return merged;

    return (await this.getRecentlyModified({ commits: 3 })).slice(0, DEFAULT_CONTEXT_LIMIT);
  }

  private async getDiffFiles(diffMode: '--cached' | ''): Promise<GitFile[]> {
    if (!this.isRepository()) return [];

    const output = this.runGit(`diff ${diffMode} --name-status`.trim());
    const files = parseNameStatusOutput(output).map((file) => ({
      ...file,
      diff: this.getFileDiff(diffMode, file.path),
    }));
    return dedupeGitFiles(files);
  }

  private getFileDiff(diffMode: string, filePath: string): string | undefined {
    try {
      const output = this.runGit(`diff ${diffMode} -- ${quote(filePath)}`.trim());
      return output.trim() ? output.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private detectBaseBranch(): string {
    try {
      const remoteHead = this.runGit('symbolic-ref refs/remotes/origin/HEAD').trim();
      const match = remoteHead.match(/refs\/remotes\/origin\/(.+)/);
      if (match?.[1]) return match[1].trim();
    } catch {
      /* fall through */
    }

    for (const branch of ['main', 'master', 'develop']) {
      try {
        this.runGit(`rev-parse --verify ${quote(branch)}`);
        return branch;
      } catch {
        /* keep trying */
      }
    }

    return 'HEAD~1';
  }

  private isRepository(): boolean {
    try {
      return this.runGit('rev-parse --is-inside-work-tree').trim() === 'true';
    } catch {
      return false;
    }
  }

  private runGit(args: string): string {
    return execSync(`git ${args}`, {
      cwd: this.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

export function renderGitContextBlock(files: GitFile[]): string {
  if (!files.length) return '';

  const parts = ['### Git context', '', 'Recently modified files to keep in mind:'];
  for (const file of files) {
    parts.push(`- ${file.status}: ${file.path}`);
    if (file.diff?.trim()) {
      parts.push('');
      parts.push('```diff');
      parts.push(truncateDiff(file.diff.trim()));
      parts.push('```');
      parts.push('');
    }
  }

  return parts.join('\n').trim();
}

function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... [truncated]` : diff;
}

function parseNameStatusOutput(output: string): GitFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split('\t').filter(Boolean);
      if (parts.length < 2) return [];
      const [rawStatus, ...rawPaths] = parts;
      const targetPath = rawPaths.at(-1);
      if (!targetPath) return [];
      return [{ path: targetPath, status: normalizeStatus(rawStatus) }];
    });
}

function parsePorcelainLine(line: string, mode: 'unstaged'): GitFile[] {
  const indexStatus = line[0] ?? ' ';
  const workTreeStatus = line[1] ?? ' ';
  const rawPath = line.slice(3).trim();
  const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1)?.trim() : rawPath;
  if (!filePath) return [];

  if (line.startsWith('??')) {
    return [{ path: filePath, status: 'added' }];
  }

  if (mode === 'unstaged' && workTreeStatus !== ' ') {
    return [{ path: filePath, status: normalizeStatus(workTreeStatus) }];
  }

  if (mode === 'unstaged' && indexStatus === 'U') {
    return [{ path: filePath, status: 'modified' }];
  }

  return [];
}

function normalizeStatus(status: string): GitFile['status'] {
  const normalized = status.trim().charAt(0);
  if (normalized === 'A' || normalized === '?') return 'added';
  if (normalized === 'D') return 'deleted';
  return 'modified';
}

function parseBlameOutput(output: string): BlameInfo {
  const lines = output.split(/\r?\n/);
  const commit = lines[0]?.split(' ')[0]?.trim();
  const author = extractBlameField(lines, 'author') || 'Unknown';
  const message = extractBlameField(lines, 'summary') || '';
  const authorTime = Number(extractBlameField(lines, 'author-time') || '0');

  return {
    author,
    date: authorTime > 0 ? new Date(authorTime * 1000).toISOString() : '',
    commit: commit || '',
    message,
  };
}

function extractBlameField(lines: string[], field: string): string | undefined {
  const prefix = `${field} `;
  return lines
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function dedupeGitFiles(files: GitFile[]): GitFile[] {
  const seen = new Set<string>();
  const result: GitFile[] = [];

  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    result.push(file);
  }

  return result;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
