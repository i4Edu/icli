import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { config } from '../config.js';

export type Permission =
  | 'shell:execute'
  | 'file:read'
  | 'file:write'
  | 'file:delete'
  | 'tool:*'
  | `tool:${string}`
  | 'command:*'
  | `command:${string}`;

export interface Role {
  name: string;
  permissions: Permission[];
}

interface RolesConfigFile {
  currentRole?: string;
  roles?: Role[];
}

export const DEFAULT_ROLE_NAME = 'developer';
export const ROLES_CONFIG_FILE = '.icopilot/roles.yaml';

export const BUILTIN_ROLES: Role[] = [
  {
    name: 'admin',
    permissions: ['shell:execute', 'file:read', 'file:write', 'file:delete', 'tool:*', 'command:*'],
  },
  {
    name: 'developer',
    permissions: ['shell:execute', 'file:read', 'file:write', 'tool:*', 'command:*'],
  },
  {
    name: 'reviewer',
    permissions: [
      'file:read',
      'tool:read_file',
      'tool:grep',
      'tool:glob',
      'tool:list_directory',
      'tool:search_symbols',
      'tool:web_fetch',
      'tool:describe_image',
      'command:*',
    ],
  },
  {
    name: 'viewer',
    permissions: [
      'file:read',
      'tool:read_file',
      'tool:grep',
      'tool:glob',
      'tool:list_directory',
      'tool:search_symbols',
      'tool:describe_image',
      'command:*',
    ],
  },
];

const TOOL_PERMISSION_MAP: Record<string, Permission> = {
  run_shell: 'shell:execute',
  run_in_terminal: 'shell:execute',
  read_file: 'file:read',
  grep: 'file:read',
  glob: 'file:read',
  list_directory: 'file:read',
  search_symbols: 'file:read',
  describe_image: 'file:read',
  write_file: 'file:write',
  write_files: 'file:write',
  edit_file: 'file:write',
  multi_edit: 'file:write',
  apply_patch: 'file:write',
};

export class RoleManager {
  private roles: Role[] = cloneRoles(BUILTIN_ROLES);
  private currentRoleName = DEFAULT_ROLE_NAME;

  constructor(private configPath = defaultRolesConfigPath()) {}

  loadRoles(configPath = this.configPath): Role[] {
    this.configPath = path.resolve(configPath);
    this.roles = cloneRoles(BUILTIN_ROLES);
    this.currentRoleName = DEFAULT_ROLE_NAME;

    try {
      if (!fs.existsSync(this.configPath)) return this.listRoles();
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const document = parseDocument(raw);
      if (document.errors.length > 0) {
        throw document.errors[0] ?? new Error('Invalid roles YAML');
      }
      const parsed = parseRolesConfig(document.toJSON());
      this.roles = mergeRoles(BUILTIN_ROLES, parsed.roles ?? []);
      this.currentRoleName = resolveRoleName(parsed.currentRole, this.roles) ?? DEFAULT_ROLE_NAME;
    } catch {
      this.roles = cloneRoles(BUILTIN_ROLES);
      this.currentRoleName = DEFAULT_ROLE_NAME;
    }

    return this.listRoles();
  }

  getCurrentRole(): Role {
    this.ensureLoaded();
    return cloneRole(this.findCurrentRole());
  }

  setRole(roleName: string): void {
    this.ensureLoaded();
    const resolved = resolveRoleName(roleName, this.roles);
    if (!resolved) {
      throw new Error(`Unknown role: ${roleName}`);
    }
    this.currentRoleName = resolved;
    this.persist();
  }

  hasPermission(permission: Permission): boolean {
    this.ensureLoaded();
    const permissions = new Set(this.findCurrentRole().permissions);
    if (permissions.has(permission)) return true;
    if (permission.startsWith('tool:') && permissions.has('tool:*')) return true;
    if (permission.startsWith('command:') && permissions.has('command:*')) return true;
    return false;
  }

  checkAccess(tool: string): { allowed: boolean; reason?: string } {
    this.ensureLoaded();
    const normalized = normalizeTarget(tool);
    const role = this.findCurrentRole();

    if (normalized.kind === 'command') {
      const permission = `command:${normalized.name}` as Permission;
      if (this.hasPermission(permission)) return { allowed: true };
      return {
        allowed: false,
        reason: `role "${role.name}" does not permit command "${normalized.name}"`,
      };
    }

    const specificPermission = `tool:${normalized.name}` as Permission;
    const impliedPermission = inferToolPermission(normalized.name);
    if (
      this.hasPermission(specificPermission) ||
      (impliedPermission && this.hasPermission(impliedPermission))
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `role "${role.name}" does not permit tool "${normalized.name}"`,
    };
  }

  listRoles(): Role[] {
    this.ensureLoaded();
    return cloneRoles(this.roles);
  }

  private ensureLoaded(): void {
    if (this.roles.length === 0) {
      this.loadRoles();
      return;
    }
    if (!this.findRole(this.currentRoleName)) {
      this.currentRoleName = DEFAULT_ROLE_NAME;
    }
  }

  private findCurrentRole(): Role {
    return this.findRole(this.currentRoleName) ?? cloneRole(BUILTIN_ROLES[1]);
  }

  private findRole(roleName: string): Role | undefined {
    return this.roles.find((role) => role.name.toLowerCase() === roleName.toLowerCase());
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, renderRolesConfig(this.currentRoleName, this.roles), 'utf8');
  }
}

export function defaultRolesConfigPath(cwd = config.cwd): string {
  return path.join(cwd, ROLES_CONFIG_FILE);
}

export function renderRolesConfig(
  currentRole = DEFAULT_ROLE_NAME,
  roles: Role[] = BUILTIN_ROLES,
): string {
  return stringify({
    currentRole,
    roles: cloneRoles(roles),
  } satisfies RolesConfigFile);
}

function parseRolesConfig(value: unknown): RolesConfigFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('roles config must contain a YAML object');
  }

  const record = value as Record<string, unknown>;
  const currentRole =
    typeof record.currentRole === 'string' && record.currentRole.trim().length > 0
      ? record.currentRole.trim()
      : undefined;

  if (record.roles !== undefined && !Array.isArray(record.roles)) {
    throw new Error('roles field must be an array');
  }

  return {
    currentRole,
    roles: Array.isArray(record.roles) ? record.roles.map(validateRole) : undefined,
  };
}

function validateRole(value: unknown): Role {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('role entries must be objects');
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    throw new Error('role name must be a non-empty string');
  }
  if (
    !Array.isArray(record.permissions) ||
    record.permissions.some(
      (permission) => typeof permission !== 'string' || permission.trim().length === 0,
    )
  ) {
    throw new Error(`role "${record.name}" permissions must be an array of non-empty strings`);
  }

  return {
    name: record.name.trim(),
    permissions: [
      ...new Set(record.permissions.map((permission) => permission.trim() as Permission)),
    ],
  };
}

function mergeRoles(base: Role[], overrides: Role[]): Role[] {
  const merged = new Map<string, Role>();
  for (const role of base) merged.set(role.name.toLowerCase(), cloneRole(role));
  for (const role of overrides) merged.set(role.name.toLowerCase(), cloneRole(role));

  const ordered: Role[] = [];
  for (const role of base) {
    const next = merged.get(role.name.toLowerCase());
    if (next) {
      ordered.push(next);
      merged.delete(role.name.toLowerCase());
    }
  }

  const custom = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  return [...ordered, ...custom];
}

function resolveRoleName(roleName: string | undefined, roles: Role[]): string | undefined {
  if (!roleName) return undefined;
  const match = roles.find((role) => role.name.toLowerCase() === roleName.toLowerCase());
  return match?.name;
}

function normalizeTarget(target: string): { kind: 'tool' | 'command'; name: string } {
  const trimmed = target.trim();
  if (trimmed.startsWith('command:')) {
    return { kind: 'command', name: trimmed.slice('command:'.length).trim() };
  }
  if (trimmed.startsWith('/')) {
    return { kind: 'command', name: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith('tool:')) {
    return { kind: 'tool', name: trimmed.slice('tool:'.length).trim() };
  }
  return { kind: 'tool', name: trimmed };
}

function inferToolPermission(toolName: string): Permission | undefined {
  if (toolName in TOOL_PERMISSION_MAP) return TOOL_PERMISSION_MAP[toolName];
  if (/(^|[_-])(delete|remove|unlink)([_-]|$)/i.test(toolName)) return 'file:delete';
  return undefined;
}

function cloneRole(role: Role): Role {
  return { name: role.name, permissions: [...role.permissions] };
}

function cloneRoles(roles: Role[]): Role[] {
  return roles.map(cloneRole);
}
