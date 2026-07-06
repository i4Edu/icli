import { theme } from '../ui/theme.js';

export interface RepoCoordination {
  id: string;
  repos: string[];
  strategy: 'sequential' | 'parallel' | 'dependency-order';
  status: 'planned' | 'running' | 'complete' | 'rolled-back' | 'conflict' | 'failed';
  changes: RepoChange[];
}

export interface RepoChange {
  repo: string;
  branch: string;
  commits: string[];
  status: 'pending' | 'applied' | 'reverted' | 'conflict';
}

export interface CoordinationOptions {
  dryRun?: boolean;
  rollbackOnFailure?: boolean;
  timeout?: number;
}

export interface CoordinationPlanChange extends Omit<RepoChange, 'status'> {
  status?: RepoChange['status'];
}

export interface CrossRepoCoordinatorOptions {
  now?: () => Date;
}

export class CrossRepoCoordinator {
  private readonly plans = new Map<string, RepoCoordination>();
  private readonly now: () => Date;

  constructor(options: CrossRepoCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  plan(
    repos: string[],
    changes: CoordinationPlanChange[],
    strategy: RepoCoordination['strategy'] = 'sequential',
  ): RepoCoordination {
    const normalizedRepos = [...new Set(repos.map((repo) => requireValue(repo, 'repo')))];
    if (normalizedRepos.length === 0) {
      throw new Error('at least one repo is required');
    }

    const coordination: RepoCoordination = {
      id: `coord-${this.plans.size + 1}-${this.now().getTime().toString(36)}`,
      repos: normalizedRepos,
      strategy,
      status: 'planned',
      changes: changes.map((change) => ({
        repo: requireValue(change.repo, 'change repo'),
        branch: requireValue(change.branch, 'change branch'),
        commits: [...new Set(change.commits.map((commit) => requireValue(commit, 'commit')))],
        status: change.status ?? 'pending',
      })),
    };
    this.plans.set(coordination.id, coordination);
    return cloneCoordination(coordination);
  }

  execute(coordinationId: string, options: CoordinationOptions = {}): RepoCoordination {
    const coordination = this.requirePlan(coordinationId);
    if (options.timeout !== undefined && options.timeout <= 0) {
      coordination.status = 'failed';
      return cloneCoordination(coordination);
    }
    if (options.dryRun) {
      coordination.status = 'planned';
      return cloneCoordination(coordination);
    }

    coordination.status = 'running';
    const orderedChanges = orderChanges(coordination);
    for (const change of orderedChanges) {
      if (change.status === 'conflict') {
        coordination.status = 'conflict';
        if (options.rollbackOnFailure) {
          this.rollback(coordination.id);
          coordination.status = 'failed';
        }
        return cloneCoordination(coordination);
      }
      if (change.status === 'pending') {
        change.status = 'applied';
      }
    }

    coordination.status = 'complete';
    return cloneCoordination(coordination);
  }

  rollback(coordinationId: string): RepoCoordination {
    const coordination = this.requirePlan(coordinationId);
    for (const change of coordination.changes) {
      if (change.status === 'applied' || change.status === 'conflict') {
        change.status = 'reverted';
      }
    }
    coordination.status = 'rolled-back';
    return cloneCoordination(coordination);
  }

  getStatus(id: string): RepoCoordination | null {
    const coordination = this.plans.get(id);
    return coordination ? cloneCoordination(coordination) : null;
  }

  listActive(): RepoCoordination[] {
    return [...this.plans.values()]
      .filter(
        (coordination) =>
          coordination.status === 'planned' ||
          coordination.status === 'running' ||
          coordination.status === 'conflict',
      )
      .map((coordination) => cloneCoordination(coordination));
  }

  resolveConflict(id: string, repo: string, resolution: string): RepoCoordination {
    const coordination = this.requirePlan(id);
    const repoName = requireValue(repo, 'repo');
    const change = coordination.changes.find((entry) => entry.repo === repoName);
    if (!change) {
      throw new Error(`repo change not found: ${repoName}`);
    }

    if (resolution.trim().toLowerCase() === 'revert') {
      change.status = 'reverted';
    } else {
      change.status = 'applied';
      if (resolution.trim().length > 0) {
        change.commits = [...change.commits, `resolution:${resolution.trim()}`];
      }
    }

    coordination.status = coordination.changes.some((entry) => entry.status === 'conflict')
      ? 'conflict'
      : coordination.changes.every(
            (entry) => entry.status === 'applied' || entry.status === 'reverted',
          )
        ? 'complete'
        : coordination.status;

    return cloneCoordination(coordination);
  }

  private requirePlan(id: string): RepoCoordination {
    const coordination = this.plans.get(id.trim());
    if (!coordination) {
      throw new Error(`coordination not found: ${id}`);
    }
    return coordination;
  }
}

export function formatCoordinationStatus(coordination: RepoCoordination): string {
  const statusTheme =
    coordination.status === 'complete'
      ? theme.ok
      : coordination.status === 'failed'
        ? theme.err
        : coordination.status === 'conflict'
          ? theme.warn
          : theme.hl;

  const lines = [
    `${theme.brand('Cross-repo coordination')} ${theme.dim(`(${coordination.id})`)}`,
    `  strategy: ${coordination.strategy}`,
    `  status: ${statusTheme(coordination.status)}`,
    `  repos: ${coordination.repos.join(', ')}`,
    '',
  ];

  for (const change of coordination.changes) {
    lines.push(
      `  ${theme.hl(change.repo)} ${theme.dim(`@ ${change.branch}`)} ${change.status} ${theme.dim(`[${change.commits.join(', ')}]`)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function orderChanges(coordination: RepoCoordination): RepoChange[] {
  if (coordination.strategy === 'parallel') {
    return [...coordination.changes].sort((left, right) => left.repo.localeCompare(right.repo));
  }
  return [...coordination.changes];
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function cloneCoordination(coordination: RepoCoordination): RepoCoordination {
  return {
    ...coordination,
    repos: [...coordination.repos],
    changes: coordination.changes.map((change) => ({
      ...change,
      commits: [...change.commits],
    })),
  };
}
