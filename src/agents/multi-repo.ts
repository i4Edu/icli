import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import simpleGit from 'simple-git';
import { parseDocument, stringify } from 'yaml';

export interface RepoConfig {
  name: string;
  path: string;
  remote?: string;
  branch?: string;
  role: string;
}

export interface RepoSearchHit {
  repo: string;
  file: string;
  line: number;
  text: string;
  absolutePath: string;
}

export interface RepoStatus extends RepoConfig {
  exists: boolean;
  git: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  currentBranch?: string;
  error?: string;
}

export interface MultiRepoStatus {
  rootDir: string;
  configPath: string;
  current?: string;
  repos: RepoStatus[];
}

export interface RepoSyncResult {
  name: string;
  path: string;
  ok: boolean;
  action: 'skipped' | 'fetched' | 'pulled' | 'error';
  message: string;
}

interface RepoConfigFile {
  current?: string;
  repos?: RepoConfig[];
}

const CONFIG_DIR = '.icopilot';
const CONFIG_FILE = 'repos.yaml';
const DEFAULT_GLOB = ['**/*'];
const DEFAULT_IGNORES = [
  '**/.git/**',
  '**/.icopilot/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_RESULTS = 50;
const MAX_RESULTS_PER_REPO = 15;

export class MultiRepoOrchestrator {
  private rootDir = process.cwd();
  private configPath = path.join(this.rootDir, CONFIG_DIR, CONFIG_FILE);
  private repos: RepoConfig[] = [];
  private currentRepoName?: string;

  loadConfig(rootDir: string): RepoConfig[] {
    this.rootDir = path.resolve(rootDir);
    this.configPath = path.join(this.rootDir, CONFIG_DIR, CONFIG_FILE);
    this.repos = [];
    this.currentRepoName = undefined;

    if (!fs.existsSync(this.configPath)) {
      return this.listRepos();
    }

    const raw = fs.readFileSync(this.configPath, 'utf8');
    const document = parseDocument(raw);
    if (document.errors.length > 0) {
      const [firstError] = document.errors;
      throw new Error(
        `Invalid YAML in ${path.relative(process.cwd(), this.configPath)}: ${firstError?.message ?? 'parse error'}`,
      );
    }

    const parsed = document.toJSON() as unknown;
    const normalized = normalizeConfigFile(parsed, this.rootDir, this.configPath);
    this.currentRepoName = normalized.current;
    this.repos = normalized.repos;
    return this.listRepos();
  }

  addRepo(config: RepoConfig): RepoConfig {
    const normalized = normalizeRepoConfig(config, this.rootDir, this.configPath);
    const existingByName = this.repos.find(
      (repo) => repo.name.toLowerCase() === normalized.name.toLowerCase(),
    );
    if (existingByName) {
      throw new Error(`repository already exists: ${existingByName.name}`);
    }

    const existingByPath = this.repos.find((repo) => samePath(repo.path, normalized.path));
    if (existingByPath) {
      throw new Error(`repository path already exists: ${existingByPath.name}`);
    }

    this.repos.push(normalized);
    if (!this.currentRepoName) {
      this.currentRepoName = normalized.name;
    }
    this.saveConfig();
    return cloneRepo(normalized);
  }

  removeRepo(name: string): boolean {
    const index = this.repos.findIndex((repo) => repo.name.toLowerCase() === name.toLowerCase());
    if (index === -1) return false;

    const [removed] = this.repos.splice(index, 1);
    if (removed && this.currentRepoName?.toLowerCase() === removed.name.toLowerCase()) {
      this.currentRepoName = this.repos[0]?.name;
    }
    this.saveConfig();
    return true;
  }

  listRepos(): RepoConfig[] {
    return this.repos.map(cloneRepo);
  }

  switchRepo(name: string): RepoConfig {
    const repo = this.repos.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!repo) {
      throw new Error(`unknown repository: ${name}`);
    }

    this.currentRepoName = repo.name;
    this.saveConfig();
    return cloneRepo(repo);
  }

  async searchAcrossRepos(query: string): Promise<RepoSearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const hits: RepoSearchHit[] = [];
    for (const repo of this.repos) {
      if (hits.length >= MAX_RESULTS) break;
      if (!fs.existsSync(repo.path) || !fs.statSync(repo.path).isDirectory()) continue;

      const files = await fg(DEFAULT_GLOB, {
        cwd: repo.path,
        onlyFiles: true,
        dot: false,
        ignore: DEFAULT_IGNORES,
        absolute: true,
        suppressErrors: true,
      });

      let repoHits = 0;
      for (const absolutePath of files) {
        if (hits.length >= MAX_RESULTS || repoHits >= MAX_RESULTS_PER_REPO) break;
        const stat = safeStat(absolutePath);
        if (!stat || stat.size > MAX_FILE_BYTES) continue;

        const raw = fs.readFileSync(absolutePath, 'utf8');
        if (raw.includes('\u0000')) continue;

        const lines = raw.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          if (!line.toLowerCase().includes(needle)) continue;
          hits.push({
            repo: repo.name,
            file: path.relative(repo.path, absolutePath) || path.basename(absolutePath),
            line: index + 1,
            text: line.trim(),
            absolutePath,
          });
          repoHits += 1;
          if (hits.length >= MAX_RESULTS || repoHits >= MAX_RESULTS_PER_REPO) break;
        }
      }
    }

    return hits;
  }

  async getStatus(): Promise<MultiRepoStatus> {
    const repos = await Promise.all(this.repos.map(async (repo) => getRepoStatus(repo)));
    return {
      rootDir: this.rootDir,
      configPath: this.configPath,
      current: this.currentRepoName,
      repos,
    };
  }

  async syncAll(): Promise<RepoSyncResult[]> {
    return Promise.all(this.repos.map(async (repo) => syncRepo(repo)));
  }

  getCurrentRepoName(): string | undefined {
    return this.currentRepoName;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private saveConfig(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const document: RepoConfigFile = {
      current: this.currentRepoName,
      repos: this.repos.map((repo) => ({
        ...repo,
        path: toPortableRelativePath(this.rootDir, repo.path),
      })),
    };
    fs.writeFileSync(this.configPath, stringify(document), 'utf8');
  }
}

async function getRepoStatus(repo: RepoConfig): Promise<RepoStatus> {
  const base: RepoStatus = {
    ...cloneRepo(repo),
    exists: false,
    git: false,
    dirty: false,
    ahead: 0,
    behind: 0,
  };

  if (!fs.existsSync(repo.path) || !fs.statSync(repo.path).isDirectory()) {
    return { ...base, error: 'path does not exist' };
  }

  base.exists = true;
  const git = simpleGit(repo.path);
  try {
    base.git = await git.checkIsRepo();
    if (!base.git) {
      return base;
    }

    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    const status = await git.status();
    return {
      ...base,
      dirty: status.files.length > 0,
      ahead: status.ahead,
      behind: status.behind,
      currentBranch: branch.trim(),
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function syncRepo(repo: RepoConfig): Promise<RepoSyncResult> {
  const missing = !fs.existsSync(repo.path) || !fs.statSync(repo.path).isDirectory();
  if (missing) {
    return {
      name: repo.name,
      path: repo.path,
      ok: false,
      action: 'error',
      message: 'path does not exist',
    };
  }

  const git = simpleGit(repo.path);
  try {
    if (!(await git.checkIsRepo())) {
      return {
        name: repo.name,
        path: repo.path,
        ok: false,
        action: 'skipped',
        message: 'not a git repository',
      };
    }

    const remotes = await git.getRemotes(true);
    if (remotes.length === 0) {
      return {
        name: repo.name,
        path: repo.path,
        ok: true,
        action: 'skipped',
        message: 'no remotes configured',
      };
    }

    await git.fetch(['--all', '--prune']);
    const status = await git.status();
    if (status.files.length > 0) {
      return {
        name: repo.name,
        path: repo.path,
        ok: true,
        action: 'fetched',
        message: 'fetched remotes; skipped pull because working tree is dirty',
      };
    }

    const remoteName = repo.remote || remotes[0]?.name;
    const branchName = repo.branch || (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (!remoteName || !branchName) {
      return {
        name: repo.name,
        path: repo.path,
        ok: true,
        action: 'fetched',
        message: 'fetched remotes',
      };
    }

    await git.pull(remoteName, branchName, { '--ff-only': null });
    return {
      name: repo.name,
      path: repo.path,
      ok: true,
      action: 'pulled',
      message: `pulled ${remoteName}/${branchName}`,
    };
  } catch (error) {
    return {
      name: repo.name,
      path: repo.path,
      ok: false,
      action: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeConfigFile(
  value: unknown,
  rootDir: string,
  configPath: string,
): { current?: string; repos: RepoConfig[] } {
  if (Array.isArray(value)) {
    return {
      repos: value.map((repo) => normalizeRepoConfig(repo, rootDir, configPath)),
    };
  }

  if (!value || typeof value !== 'object') {
    throw new Error(
      `${path.relative(process.cwd(), configPath)} must contain a YAML object or array`,
    );
  }

  const record = value as Record<string, unknown>;
  const reposValue = record.repos;
  if (reposValue !== undefined && !Array.isArray(reposValue)) {
    throw new Error(`${path.relative(process.cwd(), configPath)} field "repos" must be an array`);
  }

  const currentValue = record.current;
  if (
    currentValue !== undefined &&
    (typeof currentValue !== 'string' || currentValue.trim().length === 0)
  ) {
    throw new Error(
      `${path.relative(process.cwd(), configPath)} field "current" must be a non-empty string`,
    );
  }

  return {
    ...(typeof currentValue === 'string' ? { current: currentValue.trim() } : {}),
    repos: (reposValue ?? []).map((repo) => normalizeRepoConfig(repo, rootDir, configPath)),
  };
}

function normalizeRepoConfig(value: unknown, rootDir: string, configPath: string): RepoConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `${path.relative(process.cwd(), configPath)} repository entries must be YAML objects`,
    );
  }

  const record = value as Record<string, unknown>;
  const name = requiredString(record.name, 'name', configPath);
  const repoPath = requiredString(record.path, 'path', configPath);
  const role = requiredString(record.role, 'role', configPath);

  return {
    name,
    path: path.resolve(rootDir, repoPath),
    remote: optionalString(record.remote, 'remote', configPath),
    branch: optionalString(record.branch, 'branch', configPath),
    role,
  };
}

function requiredString(value: unknown, field: string, configPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `${path.relative(process.cwd(), configPath)} field "${field}" must be a non-empty string`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, configPath: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `${path.relative(process.cwd(), configPath)} field "${field}" must be a non-empty string`,
    );
  }
  return value.trim();
}

function cloneRepo(repo: RepoConfig): RepoConfig {
  return { ...repo };
}

function toPortableRelativePath(rootDir: string, targetPath: string): string {
  const relative = path.relative(rootDir, targetPath);
  if (!relative) return '.';
  return relative.split(path.sep).join('/');
}

function samePath(left: string, right: string): boolean {
  return path.normalize(left) === path.normalize(right);
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
