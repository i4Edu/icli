import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface AccessRule {
  role: string;
  allowCommands: string[];
  denyCommands: string[];
  allowTools: string[];
  denyTools: string[];
}

export interface AccessPolicy {
  rules: AccessRule[];
  defaultRole: string;
  enforceMode: 'strict' | 'warn' | 'permissive';
}

export interface AccessDecision {
  allowed: boolean;
  enforced: boolean;
  reason?: string;
}

const ACCESS_POLICY_FILE = path.join('.icopilot', 'access.yaml');
const DEFAULT_POLICY: AccessPolicy = {
  rules: [],
  defaultRole: 'developer',
  enforceMode: 'permissive',
};

export class AccessController {
  private policy: AccessPolicy = clonePolicy(DEFAULT_POLICY);
  private currentRole = DEFAULT_POLICY.defaultRole;
  private policyPath: string;

  constructor(policyPath = defaultAccessPolicyPath()) {
    this.policyPath = path.resolve(policyPath);
  }

  loadPolicy(policyPath = this.policyPath): AccessPolicy {
    this.policyPath = path.resolve(policyPath);
    this.policy = clonePolicy(DEFAULT_POLICY);
    this.currentRole = DEFAULT_POLICY.defaultRole;

    try {
      if (!fs.existsSync(this.policyPath)) return this.getCurrentPolicy();
      const parsed = parse(fs.readFileSync(this.policyPath, 'utf8')) as unknown;
      this.policy = normalizePolicy(parsed);
      this.currentRole = this.policy.defaultRole;
    } catch {
      this.policy = clonePolicy(DEFAULT_POLICY);
      this.currentRole = DEFAULT_POLICY.defaultRole;
    }

    return this.getCurrentPolicy();
  }

  checkCommand(command: string, role = this.currentRole): AccessDecision {
    return this.checkResource('command', normalizeCommand(command), role);
  }

  checkTool(tool: string, role = this.currentRole): AccessDecision {
    return this.checkResource('tool', normalizeTool(tool), role);
  }

  getCurrentPolicy(): AccessPolicy {
    return clonePolicy(this.policy);
  }

  setRole(role: string): void {
    const normalized = role.trim();
    if (!normalized) {
      throw new Error('role must be a non-empty string');
    }
    this.currentRole = normalized;
  }

  private checkResource(type: 'command' | 'tool', resource: string, role: string): AccessDecision {
    const rule = this.findRule(role) ?? this.findRule(this.policy.defaultRole);
    if (!rule) {
      return finalizeDecision(true, undefined, this.policy.enforceMode);
    }

    const denyList = type === 'command' ? rule.denyCommands : rule.denyTools;
    const allowList = type === 'command' ? rule.allowCommands : rule.allowTools;

    if (matchesRule(denyList, resource)) {
      return finalizeDecision(
        false,
        `${type} "${resource}" is denied for role "${rule.role}"`,
        this.policy.enforceMode,
      );
    }
    if (matchesRule(allowList, resource)) {
      return { allowed: true, enforced: false };
    }
    if (allowList.length > 0) {
      return finalizeDecision(
        false,
        `${type} "${resource}" is not allow-listed for role "${rule.role}"`,
        this.policy.enforceMode,
      );
    }
    return { allowed: true, enforced: false };
  }

  private findRule(role: string): AccessRule | undefined {
    return this.policy.rules.find((rule) => rule.role.toLowerCase() === role.trim().toLowerCase());
  }
}

export function formatAccessDenied(resource: string, role: string, policy: AccessPolicy): string {
  return [
    `${theme.err('Access denied')} ${theme.dim(`(${policy.enforceMode})`)}`,
    `  ${theme.dim('role')} ${theme.hl(role)}`,
    `  ${theme.dim('resource')} ${theme.hl(resource)}`,
    `  ${theme.dim('default role')} ${theme.hl(policy.defaultRole)}`,
  ].join('\n');
}

function defaultAccessPolicyPath(cwd = config.cwd): string {
  return path.join(cwd, ACCESS_POLICY_FILE);
}

function normalizePolicy(value: unknown): AccessPolicy {
  if (!isRecord(value)) return clonePolicy(DEFAULT_POLICY);
  return {
    rules: Array.isArray(value.rules) ? value.rules.map((rule) => normalizeRule(rule)) : [],
    defaultRole: normalizeNonEmptyString(value.defaultRole) ?? DEFAULT_POLICY.defaultRole,
    enforceMode: normalizeMode(value.enforceMode) ?? DEFAULT_POLICY.enforceMode,
  };
}

function normalizeRule(value: unknown): AccessRule {
  if (!isRecord(value)) {
    return {
      role: 'unknown',
      allowCommands: [],
      denyCommands: [],
      allowTools: [],
      denyTools: [],
    };
  }

  return {
    role: normalizeNonEmptyString(value.role) ?? 'unknown',
    allowCommands: normalizePatterns(value.allowCommands, normalizeCommand),
    denyCommands: normalizePatterns(value.denyCommands, normalizeCommand),
    allowTools: normalizePatterns(value.allowTools, normalizeTool),
    denyTools: normalizePatterns(value.denyTools, normalizeTool),
  };
}

function normalizePatterns(value: unknown, normalizer: (value: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isNonEmptyString).map((entry) => normalizer(entry.trim())))];
}

function normalizeCommand(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('command:')) return trimmed.slice('command:'.length).trim().toLowerCase();
  if (trimmed.startsWith('/')) return trimmed.slice(1).trim().toLowerCase();
  return trimmed.toLowerCase();
}

function normalizeTool(value: string): string {
  return value.trim().toLowerCase();
}

function matchesRule(patterns: string[], resource: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, resource));
}

function matchesPattern(pattern: string, resource: string): boolean {
  if (pattern === '*' || pattern === resource) return true;
  if (pattern.endsWith('*')) {
    return resource.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function finalizeDecision(
  allowed: boolean,
  reason: string | undefined,
  mode: AccessPolicy['enforceMode'],
): AccessDecision {
  if (allowed) return { allowed: true, enforced: false, reason };
  if (mode === 'strict') return { allowed: false, enforced: true, reason };
  if (mode === 'warn') return { allowed: true, enforced: false, reason };
  return { allowed: true, enforced: false, reason };
}

function clonePolicy(policy: AccessPolicy): AccessPolicy {
  return {
    rules: policy.rules.map((rule) => ({
      role: rule.role,
      allowCommands: [...rule.allowCommands],
      denyCommands: [...rule.denyCommands],
      allowTools: [...rule.allowTools],
      denyTools: [...rule.denyTools],
    })),
    defaultRole: policy.defaultRole,
    enforceMode: policy.enforceMode,
  };
}

function normalizeMode(value: unknown): AccessPolicy['enforceMode'] | undefined {
  return value === 'strict' || value === 'warn' || value === 'permissive' ? value : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
