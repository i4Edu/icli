import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { theme } from '../ui/theme.js';

interface ProcResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function worktreeCommand(args: string[], cwd: string): string {
  if (!isGitRepo(cwd)) {
    return `${theme.warn(`Not a git repository: ${cwd}`)}\n`;
  }

  const [subcommand = 'list', ...rest] = args;
  switch (subcommand.toLowerCase()) {
    case 'list':
      return listWorktrees(cwd);
    case 'add':
      return addWorktree(rest, cwd);
    case 'remove':
    case 'rm':
      return removeWorktree(rest, cwd);
    case 'prune':
      return pruneWorktrees(cwd);
    default:
      return usage();
  }
}

function usage(): string {
  return (
    'usage: /worktree list\n' +
    '       /worktree add <branch> [path]\n' +
    '       /worktree remove <path> [--force]\n' +
    '       /worktree prune\n'
  );
}

function listWorktrees(cwd: string): string {
  const result = runGit(['worktree', 'list', '--porcelain'], cwd);
  if (result.status !== 0) return `${theme.err(`git worktree list failed: ${result.stderr || 'unknown error'}`)}\n`;
  const items = parseWorktreeList(result.stdout);
  if (items.length === 0) return `${theme.dim('No worktrees found.\n')}`;

  const lines = [theme.brand('Git worktrees')];
  for (const item of items) {
    const branch = item.branch ? item.branch.replace('refs/heads/', '') : '(detached)';
    lines.push(`  ${theme.hl(item.path)}`);
    lines.push(`    branch: ${branch}`);
    lines.push(`    head:   ${item.head}`);
  }
  lines.push('');
  return lines.join('\n');
}

function addWorktree(args: string[], cwd: string): string {
  const [branch, providedPath] = args;
  if (!branch) return usage();

  const targetPath = path.resolve(cwd, providedPath || path.join('.worktrees', sanitizeBranch(branch)));
  const branchExists = runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd).status === 0;
  const cmd = branchExists
    ? ['worktree', 'add', targetPath, branch]
    : ['worktree', 'add', '-b', branch, targetPath];
  const result = runGit(cmd, cwd);

  if (result.status !== 0) {
    return `${theme.err(`git worktree add failed: ${result.stderr || 'unknown error'}`)}\n`;
  }
  return `${theme.ok(`✔ worktree added: ${targetPath}`)}\n`;
}

function removeWorktree(args: string[], cwd: string): string {
  const force = args.includes('--force');
  const target = args.find((value) => value !== '--force');
  if (!target) return usage();

  const resolved = path.resolve(cwd, target);
  const cmd = ['worktree', 'remove', ...(force ? ['--force'] : []), resolved];
  const result = runGit(cmd, cwd);
  if (result.status !== 0) {
    return `${theme.err(`git worktree remove failed: ${result.stderr || 'unknown error'}`)}\n`;
  }
  return `${theme.ok(`✔ worktree removed: ${resolved}`)}\n`;
}

function pruneWorktrees(cwd: string): string {
  const result = runGit(['worktree', 'prune'], cwd);
  if (result.status !== 0) {
    return `${theme.err(`git worktree prune failed: ${result.stderr || 'unknown error'}`)}\n`;
  }
  return `${theme.ok('✔ pruned stale worktree metadata')}\n`;
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[\\/:\s]+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function isGitRepo(cwd: string): boolean {
  return runGit(['rev-parse', '--is-inside-work-tree'], cwd).status === 0;
}

function runGit(args: string[], cwd: string): ProcResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function parseWorktreeList(stdout: string): Array<{ path: string; branch?: string; head: string }> {
  const entries: Array<{ path: string; branch?: string; head: string }> = [];
  const blocks = stdout
    .split(/\n(?=worktree )/g)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    const pathLine = lines.find((line) => line.startsWith('worktree '));
    const headLine = lines.find((line) => line.startsWith('HEAD '));
    if (!pathLine || !headLine) continue;
    const branchLine = lines.find((line) => line.startsWith('branch '));
    entries.push({
      path: pathLine.slice('worktree '.length).trim(),
      branch: branchLine ? branchLine.slice('branch '.length).trim() : undefined,
      head: headLine.slice('HEAD '.length).trim(),
    });
  }
  return entries;
}
