import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import {
  MultiRepoOrchestrator,
  type MultiRepoStatus,
  type RepoConfig,
  type RepoSearchHit,
} from '../agents/multi-repo.js';
import { theme } from '../ui/theme.js';

export const MULTI_REPO_ROOT_ENV = 'ICOPILOT_MULTI_REPO_ROOT';

export interface RepoCommandOptions {
  cwd: string;
  onSwitch?: (repo: RepoConfig, rootDir: string) => void;
}

export async function repoCommand(args: string[], options: RepoCommandOptions): Promise<string> {
  const rootDir = resolveMultiRepoRoot(options.cwd);
  const orchestrator = new MultiRepoOrchestrator();
  orchestrator.loadConfig(rootDir);

  const [rawSubcommand = 'show', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  try {
    switch (subcommand) {
      case 'show':
      case 'list':
        return formatRepoList(await orchestrator.getStatus());
      case 'add':
        return addRepo(orchestrator, rootDir, rest, options.cwd);
      case 'remove':
      case 'delete':
      case 'rm':
        return removeRepo(orchestrator, rest);
      case 'switch':
        return switchRepo(orchestrator, rootDir, rest, options);
      case 'status':
        return formatRepoStatus(await orchestrator.getStatus());
      case 'search':
        return searchRepos(orchestrator, rest);
      default:
        return repoUsage();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return theme.err(`repo: ${message}\n`);
  }
}

export function resolveMultiRepoRoot(cwd: string): string {
  const envRoot = process.env[MULTI_REPO_ROOT_ENV];
  if (envRoot && fs.existsSync(envRoot)) {
    return path.resolve(envRoot);
  }

  const discovered = findConfigRoot(cwd);
  return discovered ?? path.resolve(cwd);
}

function findConfigRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(current, '.icopilot', 'repos.yaml');
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function addRepo(
  orchestrator: MultiRepoOrchestrator,
  rootDir: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const repoPathArg = args[0];
  if (!repoPathArg) return theme.warn('usage: /repo add <path> [name]\n');

  const repoPath = path.resolve(cwd, repoPathArg);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return theme.err(`repo path does not exist: ${repoPath}\n`);
  }

  const explicitName = args.slice(1).join(' ').trim();
  const metadata = await detectRepoMetadata(repoPath);
  const repos = orchestrator.listRepos();
  const repo = orchestrator.addRepo({
    name: explicitName || path.basename(repoPath),
    path: repoPath,
    remote: metadata.remote,
    branch: metadata.branch,
    role: repos.length === 0 ? 'primary' : 'peer',
  });
  process.env[MULTI_REPO_ROOT_ENV] = rootDir;

  const parts = [`✔ added repo ${theme.hl(repo.name)} ${theme.dim(`→ ${repo.path}`)}`];
  if (repo.branch) parts.push(theme.dim(`branch=${repo.branch}`));
  if (repo.remote) parts.push(theme.dim(`remote=${repo.remote}`));
  return `${parts.join(' ')}\n`;
}

function removeRepo(orchestrator: MultiRepoOrchestrator, args: string[]): string {
  const name = args.join(' ').trim();
  if (!name) return theme.warn('usage: /repo remove <name>\n');
  if (!orchestrator.removeRepo(name)) {
    return theme.warn(`unknown repo: ${name}\n`);
  }
  return theme.ok(`✔ removed repo ${name}\n`);
}

function switchRepo(
  orchestrator: MultiRepoOrchestrator,
  rootDir: string,
  args: string[],
  options: RepoCommandOptions,
): string {
  const name = args.join(' ').trim();
  if (!name) return theme.warn('usage: /repo switch <name>\n');

  const repo = orchestrator.switchRepo(name);
  process.env[MULTI_REPO_ROOT_ENV] = rootDir;
  options.onSwitch?.(repo, rootDir);
  return theme.ok(`✔ switched repo ${repo.name} ${theme.dim(`→ ${repo.path}`)}\n`);
}

async function searchRepos(orchestrator: MultiRepoOrchestrator, args: string[]): Promise<string> {
  const query = args.join(' ').trim();
  if (!query) return theme.warn('usage: /repo search <query>\n');
  const hits = await orchestrator.searchAcrossRepos(query);
  if (!hits.length) {
    return theme.dim(`No matches found across ${orchestrator.listRepos().length} repos.\n`);
  }
  return formatRepoSearchResults(query, hits);
}

async function detectRepoMetadata(repoPath: string): Promise<{
  branch?: string;
  remote?: string;
}> {
  try {
    const git = simpleGit(repoPath);
    if (!(await git.checkIsRepo())) return {};
    const remotes = await git.getRemotes(true);
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    return {
      branch: branch || undefined,
      remote: remotes[0]?.name,
    };
  } catch {
    return {};
  }
}

function formatRepoList(status: MultiRepoStatus): string {
  if (!status.repos.length) {
    return `${theme.brand('Repositories')} ${theme.dim(status.rootDir)}\n  ${theme.dim('No repositories configured. Use /repo add <path> [name].')}\n`;
  }

  const lines = [`${theme.brand('Repositories')} ${theme.dim(status.rootDir)}`, ''];
  for (const repo of status.repos) {
    const marker = repo.name === status.current ? theme.ok('*') : theme.dim('-');
    const branch = repo.branch || repo.currentBranch;
    lines.push(
      `  ${marker} ${theme.hl(repo.name)} ${theme.dim(`(${repo.role})`)} ${theme.dim('→')} ${repo.path}${branch ? theme.dim(` [${branch}]`) : ''}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatRepoStatus(status: MultiRepoStatus): string {
  if (!status.repos.length) {
    return `${theme.brand('Repo status')} ${theme.dim(status.rootDir)}\n  ${theme.dim('No repositories configured.')}\n`;
  }

  const lines = [
    `${theme.brand('Repo status')} ${theme.dim(status.rootDir)}`,
    `  config: ${status.configPath}`,
    `  current: ${status.current ? theme.hl(status.current) : theme.dim('none')}`,
    '',
  ];

  for (const repo of status.repos) {
    const health = !repo.exists
      ? theme.err('missing')
      : repo.error
        ? theme.err('error')
        : repo.git
          ? theme.ok(repo.dirty ? 'dirty' : 'clean')
          : theme.warn('not-git');
    const branch = repo.currentBranch || repo.branch || theme.dim('n/a');
    lines.push(`  ${theme.hl(repo.name)} ${health} ${theme.dim(`(${repo.role})`)}`);
    lines.push(`    path: ${repo.path}`);
    lines.push(`    branch: ${branch}`);
    if (repo.git) {
      lines.push(`    ahead/behind: ${repo.ahead}/${repo.behind}`);
    }
    if (repo.error) {
      lines.push(`    error: ${repo.error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatRepoSearchResults(query: string, hits: RepoSearchHit[]): string {
  const lines = [`${theme.brand('Repo search')} ${theme.dim(`for "${query}"`)}`, ''];
  for (const hit of hits) {
    lines.push(`  ${theme.hl(hit.repo)} ${theme.dim('→')} ${hit.file}:${hit.line}`);
    lines.push(`    ${hit.text}`);
  }
  lines.push('');
  return lines.join('\n');
}

function repoUsage(): string {
  return [
    'usage: /repo',
    '       /repo add <path> [name]',
    '       /repo remove <name>',
    '       /repo switch <name>',
    '       /repo status',
    '       /repo search <query>',
    '',
  ].join('\n');
}
