import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface FleetPolicy {
  id: string;
  name: string;
  version: string;
  rules: PolicyRule[];
  targets: string[];
  rolloutStrategy: 'all' | 'canary' | 'progressive';
}

export interface PolicyRule {
  id: string;
  type: string;
  condition: string;
  action: string;
  severity: string;
}

export interface PolicyRollout {
  policyId: string;
  status: 'pending' | 'rolling' | 'complete' | 'failed';
  progress: number;
  targets: string[];
  startedAt: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FleetPolicyManagerOptions {
  policies?: FleetPolicy[];
  now?: () => Date;
}

const FLEET_POLICIES_FILE = path.join('.icopilot', 'enterprise', 'fleet-policies.yaml');

export class FleetPolicyManager {
  private readonly policies = new Map<string, FleetPolicy>();
  private readonly rollouts = new Map<string, PolicyRollout>();
  private readonly now: () => Date;

  constructor(options: FleetPolicyManagerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    for (const policy of options.policies ?? []) {
      this.createPolicy(policy);
    }
  }

  createPolicy(policy: FleetPolicy): FleetPolicy {
    const normalized = normalizePolicy(policy);
    const validation = this.validatePolicy(normalized);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }
    this.policies.set(normalized.id, normalized);
    return clonePolicy(normalized);
  }

  deployPolicy(
    id: string,
    strategy?: FleetPolicy['rolloutStrategy'],
  ): PolicyRollout {
    const policy = this.requirePolicy(id);
    const effectiveStrategy = strategy ?? policy.rolloutStrategy;
    const rollout = createRollout(policy.id, policy.targets, effectiveStrategy, this.now().toISOString());
    this.rollouts.set(policy.id, rollout);
    return cloneRollout(rollout);
  }

  rollback(id: string): PolicyRollout {
    const policy = this.requirePolicy(id);
    const existing = this.rollouts.get(policy.id);
    const rollback: PolicyRollout = {
      policyId: policy.id,
      status: 'failed',
      progress: 0,
      targets: [...(existing?.targets ?? policy.targets)],
      startedAt: this.now().toISOString(),
    };
    this.rollouts.set(policy.id, rollback);
    return cloneRollout(rollback);
  }

  getStatus(id: string): PolicyRollout | null;
  getStatus(): PolicyRollout[];
  getStatus(id?: string): PolicyRollout | PolicyRollout[] | null {
    if (typeof id === 'string') {
      const rollout = this.rollouts.get(id);
      return rollout ? cloneRollout(rollout) : null;
    }
    return [...this.rollouts.values()].map((rollout) => cloneRollout(rollout));
  }

  listPolicies(): FleetPolicy[] {
    return [...this.policies.values()].map(clonePolicy).sort((left, right) => left.name.localeCompare(right.name));
  }

  validatePolicy(policy: FleetPolicy): PolicyValidationResult {
    const errors: string[] = [];
    if (!policy.id.trim()) errors.push('policy id is required');
    if (!policy.name.trim()) errors.push('policy name is required');
    if (!policy.version.trim()) errors.push('policy version is required');
    if (policy.rules.length === 0) errors.push('policy must include at least one rule');
    if (policy.targets.length === 0) errors.push('policy must include at least one target');
    for (const rule of policy.rules) {
      if (!rule.id.trim()) errors.push('policy rule id is required');
      if (!rule.type.trim()) errors.push(`policy rule ${rule.id || '<unknown>'} type is required`);
      if (!rule.condition.trim()) errors.push(`policy rule ${rule.id || '<unknown>'} condition is required`);
      if (!rule.action.trim()) errors.push(`policy rule ${rule.id || '<unknown>'} action is required`);
      if (!rule.severity.trim()) errors.push(`policy rule ${rule.id || '<unknown>'} severity is required`);
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private requirePolicy(id: string): FleetPolicy {
    const policy = this.policies.get(id.trim());
    if (!policy) {
      throw new Error(`policy not found: ${id}`);
    }
    return policy;
  }
}

export function loadFleetPolicies(cwd = config.cwd): FleetPolicy[] {
  const file = path.join(path.resolve(cwd), FLEET_POLICIES_FILE);
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = parse(fs.readFileSync(file, 'utf8')) as unknown;
    const rawPolicies =
      Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).policies)
          ? ((parsed as Record<string, unknown>).policies as unknown[])
          : [];
    return rawPolicies.map((policy) => normalizePolicy(policy as FleetPolicy));
  } catch {
    return [];
  }
}

export function formatPolicyRollout(rollout: PolicyRollout): string {
  const statusTheme =
    rollout.status === 'complete'
      ? theme.ok
      : rollout.status === 'failed'
        ? theme.err
        : rollout.status === 'rolling'
          ? theme.hl
          : theme.warn;

  return [
    `${theme.brand('Policy rollout')} ${theme.dim(`(${rollout.policyId})`)}`,
    `  status: ${statusTheme(rollout.status)}`,
    `  progress: ${rollout.progress}%`,
    `  targets: ${rollout.targets.join(', ') || 'none'}`,
    `  started: ${rollout.startedAt}`,
    '',
  ].join('\n');
}

function normalizePolicy(policy: FleetPolicy): FleetPolicy {
  return {
    id: requireValue(policy.id, 'policy id'),
    name: requireValue(policy.name, 'policy name'),
    version: requireValue(policy.version, 'policy version'),
    rules: policy.rules.map((rule) => ({
      id: requireValue(rule.id, 'rule id'),
      type: requireValue(rule.type, 'rule type'),
      condition: requireValue(rule.condition, 'rule condition'),
      action: requireValue(rule.action, 'rule action'),
      severity: requireValue(rule.severity, 'rule severity'),
    })),
    targets: [...new Set(policy.targets.map((target) => requireValue(target, 'policy target')))],
    rolloutStrategy: policy.rolloutStrategy,
  };
}

function createRollout(
  policyId: string,
  targets: string[],
  strategy: FleetPolicy['rolloutStrategy'],
  startedAt: string,
): PolicyRollout {
  if (strategy === 'all' || targets.length <= 1) {
    return {
      policyId,
      status: 'complete',
      progress: 100,
      targets: [...targets],
      startedAt,
    };
  }

  return {
    policyId,
    status: 'rolling',
    progress: strategy === 'canary' ? Math.max(1, Math.round(100 / targets.length)) : 25,
    targets: [...targets],
    startedAt,
  };
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function clonePolicy(policy: FleetPolicy): FleetPolicy {
  return {
    ...policy,
    rules: policy.rules.map((rule) => ({ ...rule })),
    targets: [...policy.targets],
  };
}

function cloneRollout(rollout: PolicyRollout): PolicyRollout {
  return {
    ...rollout,
    targets: [...rollout.targets],
  };
}
