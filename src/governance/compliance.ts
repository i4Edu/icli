import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';
import { loadAuditStreamConfig } from './audit-stream.js';
import { loadOrgConfig } from './org-config.js';

export interface ComplianceProfile {
  name: string;
  description: string;
  rules: ComplianceRule[];
  severity: 'info' | 'warning' | 'error';
}

export interface ComplianceRule {
  id: string;
  description: string;
  check: string;
  params?: Record<string, unknown>;
}

export interface ComplianceResult {
  profile: string;
  passed: string[];
  failed: string[];
  warnings: string[];
  score: number;
}

export const BUILTIN_PROFILES: Record<'SOC2' | 'HIPAA', ComplianceProfile> = {
  SOC2: {
    name: 'SOC2',
    description: 'Operational controls for auditability, encryption, and log hygiene.',
    severity: 'error',
    rules: [
      {
        id: 'require-audit-log',
        description: 'Require centralized audit logging to be enabled.',
        check: 'checkAuditLogging',
      },
      {
        id: 'enforce-encryption',
        description: 'Require encryption-related governance policy.',
        check: 'checkEncryptionPolicy',
      },
      {
        id: 'no-pii-in-logs',
        description: 'Require a policy that forbids PII in logs.',
        check: 'checkNoPiiInLogs',
      },
    ],
  },
  HIPAA: {
    name: 'HIPAA',
    description: 'Privacy-centric controls for healthcare data handling.',
    severity: 'error',
    rules: [
      {
        id: 'require-audit-log',
        description: 'Require centralized audit logging to be enabled.',
        check: 'checkAuditLogging',
      },
      {
        id: 'enforce-encryption',
        description: 'Require encryption-related governance policy.',
        check: 'checkEncryptionPolicy',
      },
      {
        id: 'no-pii-in-logs',
        description: 'Require a policy that forbids PII in logs.',
        check: 'checkNoPiiInLogs',
      },
    ],
  },
};

export function runComplianceCheck(
  profile: ComplianceProfile,
  context: { cwd: string },
): ComplianceResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];

  for (const rule of profile.rules) {
    const checker = CHECKS[rule.check];
    if (!checker) {
      warnings.push(`${rule.id}: unknown check ${rule.check}`);
      continue;
    }

    const ok = checker(context, rule.params);
    if (ok) {
      passed.push(rule.id);
      continue;
    }

    if (profile.severity === 'error') failed.push(rule.id);
    else warnings.push(rule.id);
  }

  const total = profile.rules.length;
  const score = total === 0 ? 100 : Math.round((passed.length / total) * 100);
  return {
    profile: profile.name,
    passed,
    failed,
    warnings,
    score,
  };
}

export function formatComplianceResult(result: ComplianceResult): string {
  const summary = result.failed.length > 0 ? theme.err('failed') : theme.ok('passed');
  const lines = [
    `${theme.brand('Compliance')} ${theme.hl(result.profile)} ${summary} ${theme.dim(`(${result.score}%)`)}`,
    `  ${theme.dim('passed')} ${result.passed.length ? result.passed.join(', ') : theme.dim('none')}`,
    `  ${theme.dim('failed')} ${result.failed.length ? result.failed.join(', ') : theme.dim('none')}`,
    `  ${theme.dim('warnings')} ${result.warnings.length ? result.warnings.join(', ') : theme.dim('none')}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function listProfiles(): ComplianceProfile[] {
  return Object.values(BUILTIN_PROFILES).map(cloneProfile);
}

const CHECKS: Record<string, ComplianceCheck> = {
  checkAuditLogging: (context) => {
    const streamConfig = loadAuditStreamConfig(context.cwd);
    if (streamConfig.enabled && streamConfig.sinks.length > 0) return true;
    return fs.existsSync(path.join(context.cwd, '.icopilot', 'audit.log'));
  },
  checkEncryptionPolicy: (context) => {
    const orgConfig = loadOrgConfig(context.cwd);
    if (!orgConfig) return false;
    return orgConfig.policies.includes('enforce-encryption');
  },
  checkNoPiiInLogs: (context) => {
    const orgConfig = loadOrgConfig(context.cwd);
    if (!orgConfig) return false;
    return orgConfig.policies.includes('no-pii-in-logs');
  },
};

type ComplianceCheck = (context: { cwd: string }, params?: Record<string, unknown>) => boolean;

function cloneProfile(profile: ComplianceProfile): ComplianceProfile {
  return {
    name: profile.name,
    description: profile.description,
    severity: profile.severity,
    rules: profile.rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      check: rule.check,
      params: rule.params ? { ...rule.params } : undefined,
    })),
  };
}
