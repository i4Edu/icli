import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export type WorkspaceMemoryScope = 'private' | 'workspace' | 'organization';

export interface Workspace {
  id: string;
  name: string;
  owner: string;
  members: string[];
  policies: string[];
  memoryScope: WorkspaceMemoryScope;
  createdAt: string;
}

export interface WorkspaceConfig {
  isolation: 'strict' | 'shared';
  memorySharing: boolean;
  policyInheritance: boolean;
}

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  isolation: WorkspaceConfig['isolation'];
  memoryScope: Workspace['memoryScope'];
  sharedMemory: boolean;
  inheritedPolicies: boolean;
  owner: string;
  members: string[];
  policies: string[];
  cwd: string;
}

export interface WorkspaceCreateInput {
  id: string;
  name: string;
  owner: string;
  members?: string[];
  policies?: string[];
  memoryScope?: Workspace['memoryScope'];
  createdAt?: string;
}

const WORKSPACE_CONFIG_FILE = path.join('.icopilot', 'enterprise', 'workspace-tenancy.yaml');
const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  isolation: 'strict',
  memorySharing: false,
  policyInheritance: true,
};

export class WorkspaceTenancy {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(private readonly workspaceConfig: WorkspaceConfig = loadWorkspaceConfig() ?? DEFAULT_WORKSPACE_CONFIG) {}

  createWorkspace(input: WorkspaceCreateInput): Workspace {
    const workspace = normalizeWorkspace(input, this.workspaceConfig);
    if (this.workspaces.has(workspace.id)) {
      throw new Error(`workspace already exists: ${workspace.id}`);
    }
    this.workspaces.set(workspace.id, workspace);
    return cloneWorkspace(workspace);
  }

  getWorkspace(id: string): Workspace | null {
    const workspace = this.workspaces.get(id);
    return workspace ? cloneWorkspace(workspace) : null;
  }

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()].map(cloneWorkspace).sort((left, right) => {
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
  }

  deleteWorkspace(id: string): boolean {
    return this.workspaces.delete(id);
  }

  addMember(workspaceId: string, userId: string): Workspace {
    const workspace = this.requireWorkspace(workspaceId);
    workspace.members = dedupeStrings([...workspace.members, normalizeRequired(userId, 'user id')]);
    return cloneWorkspace(workspace);
  }

  removeMember(workspaceId: string, userId: string): Workspace {
    const workspace = this.requireWorkspace(workspaceId);
    const normalizedUserId = normalizeRequired(userId, 'user id');
    if (normalizedUserId === workspace.owner) {
      throw new Error('cannot remove workspace owner');
    }
    workspace.members = workspace.members.filter((member) => member !== normalizedUserId);
    return cloneWorkspace(workspace);
  }

  getIsolatedContext(workspaceId: string): WorkspaceContext {
    const workspace = this.requireWorkspace(workspaceId);
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      isolation: this.workspaceConfig.isolation,
      memoryScope: workspace.memoryScope,
      sharedMemory: this.workspaceConfig.memorySharing && workspace.memoryScope !== 'private',
      inheritedPolicies: this.workspaceConfig.policyInheritance,
      owner: workspace.owner,
      members: [...workspace.members],
      policies: [...workspace.policies],
      cwd: config.cwd,
    };
  }

  private requireWorkspace(id: string): Workspace {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      throw new Error(`workspace not found: ${id}`);
    }
    return workspace;
  }
}

export function loadWorkspaceConfig(cwd = config.cwd): WorkspaceConfig | null {
  const file = path.join(path.resolve(cwd), WORKSPACE_CONFIG_FILE);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = parse(fs.readFileSync(file, 'utf8')) as unknown;
    return normalizeWorkspaceConfig(parsed);
  } catch {
    return null;
  }
}

export function formatWorkspaceList(workspaces: Workspace[]): string {
  if (workspaces.length === 0) {
    return `${theme.brand('Workspaces')}\n  ${theme.dim('No workspaces configured.')}\n`;
  }

  const lines = [theme.brand('Workspaces'), ''];
  for (const workspace of workspaces) {
    lines.push(
      `  ${theme.hl(workspace.name)} ${theme.dim(`(${workspace.id})`)} ${theme.dim('owner:')} ${workspace.owner}`,
    );
    lines.push(
      `    members: ${workspace.members.length}  policies: ${workspace.policies.length}  memory: ${workspace.memoryScope}`,
    );
    if (workspace.policies.length > 0) {
      lines.push(`    policy names: ${workspace.policies.join(', ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function normalizeWorkspace(
  input: WorkspaceCreateInput,
  workspaceConfig: WorkspaceConfig,
): Workspace {
  const owner = normalizeRequired(input.owner, 'workspace owner');
  const members = dedupeStrings([owner, ...(input.members ?? [])]);
  const policies = dedupeStrings(input.policies ?? []);
  return {
    id: normalizeRequired(input.id, 'workspace id'),
    name: normalizeRequired(input.name, 'workspace name'),
    owner,
    members,
    policies,
    memoryScope:
      input.memoryScope ??
      (workspaceConfig.memorySharing ? 'workspace' : workspaceConfig.isolation === 'shared' ? 'organization' : 'private'),
    createdAt: normalizeTimestamp(input.createdAt),
  };
}

function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }
  const record = value as Record<string, unknown>;
  return {
    isolation: record.isolation === 'shared' ? 'shared' : 'strict',
    memorySharing: typeof record.memorySharing === 'boolean' ? record.memorySharing : false,
    policyInheritance:
      typeof record.policyInheritance === 'boolean'
        ? record.policyInheritance
        : DEFAULT_WORKSPACE_CONFIG.policyInheritance,
  };
}

function normalizeRequired(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function normalizeTimestamp(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    members: [...workspace.members],
    policies: [...workspace.policies],
  };
}
