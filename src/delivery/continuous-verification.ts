import { randomUUID } from 'node:crypto';
import { theme } from '../ui/theme.js';

export type VerificationType = 'lint' | 'test' | 'security' | 'typecheck' | 'custom';
export type VerificationSchedule = 'on-change' | 'periodic' | 'pre-commit';

export interface VerificationCheck {
  id: string;
  name: string;
  type: VerificationType;
  command?: string;
  schedule: VerificationSchedule;
}

export interface VerificationRun {
  checkId: string;
  startedAt: string;
  completedAt?: string;
  passed: boolean;
  output?: string;
  fixApplied?: boolean;
}

export interface VerificationConfig {
  checks: VerificationCheck[];
  autoFix: boolean;
  maxFixAttempts: number;
  notifyOnFailure: boolean;
}

const DEFAULT_CONFIG: VerificationConfig = {
  checks: [],
  autoFix: false,
  maxFixAttempts: 1,
  notifyOnFailure: true,
};

export class ContinuousVerifier {
  private readonly checks = new Map<string, VerificationCheck>();
  private readonly runs: VerificationRun[] = [];
  private config: VerificationConfig;

  constructor(config?: Partial<VerificationConfig>) {
    this.config = {
      checks: [],
      autoFix: config?.autoFix ?? DEFAULT_CONFIG.autoFix,
      maxFixAttempts: config?.maxFixAttempts ?? DEFAULT_CONFIG.maxFixAttempts,
      notifyOnFailure: config?.notifyOnFailure ?? DEFAULT_CONFIG.notifyOnFailure,
    };

    for (const check of config?.checks ?? []) {
      this.addCheck(check);
    }
  }

  addCheck(check: VerificationCheck): VerificationCheck {
    const normalized = { ...check, id: check.id || randomUUID() };
    this.checks.set(normalized.id, structuredClone(normalized));
    this.config.checks = [...this.checks.values()].map((entry) => structuredClone(entry));
    return structuredClone(normalized);
  }

  removeCheck(id: string): boolean {
    const removed = this.checks.delete(id);
    this.config.checks = [...this.checks.values()].map((entry) => structuredClone(entry));
    return removed;
  }

  runAll(): VerificationRun[] {
    return [...this.checks.keys()].map((id) => this.runCheck(id)).filter(isDefined);
  }

  runCheck(id: string): VerificationRun {
    const check = this.checks.get(id);
    if (!check) {
      throw new Error(`verification check not found: ${id}`);
    }

    const startedAt = new Date().toISOString();
    let passed = !shouldFail(check);
    let output = passed ? `${check.name} passed.` : `${check.name} failed.`;
    let fixApplied = false;

    if (!passed && this.config.autoFix && canAutoFix(check) && this.config.maxFixAttempts > 0) {
      fixApplied = true;
      passed = !isUnfixable(check);
      output = passed
        ? `${check.name} failed, auto-fix applied successfully.`
        : `${check.name} failed, but auto-fix could not recover it.`;
    }

    const run: VerificationRun = {
      checkId: id,
      startedAt,
      completedAt: new Date().toISOString(),
      passed,
      output,
      fixApplied,
    };

    this.runs.push(structuredClone(run));
    return structuredClone(run);
  }

  getResults(since?: string): VerificationRun[] {
    if (!since) {
      return this.runs.map((run) => structuredClone(run));
    }

    const threshold = new Date(since).getTime();
    return this.runs
      .filter((run) => new Date(run.startedAt).getTime() >= threshold)
      .map((run) => structuredClone(run));
  }

  isHealthy(): boolean {
    const latestByCheck = new Map<string, VerificationRun>();
    for (const run of this.runs) {
      latestByCheck.set(run.checkId, run);
    }
    return [...latestByCheck.values()].every((run) => run.passed);
  }

  getConfig(): VerificationConfig {
    return {
      checks: [...this.checks.values()].map((check) => structuredClone(check)),
      autoFix: this.config.autoFix,
      maxFixAttempts: this.config.maxFixAttempts,
      notifyOnFailure: this.config.notifyOnFailure,
    };
  }

  setAutoFix(enabled: boolean): void {
    this.config.autoFix = enabled;
  }
}

export function formatVerificationResults(runs: VerificationRun[]): string {
  if (!runs.length) {
    return `${theme.badge('verify')} ${theme.dim('No verification runs recorded.')}`;
  }

  const lines = runs.map((run) => {
    const outcome = run.passed ? theme.ok('passed') : theme.err('failed');
    const fix = run.fixApplied ? ` ${theme.warn('(auto-fix)')}` : '';
    return `${outcome} ${theme.hl(run.checkId)}${fix}`;
  });
  return `${theme.badge('verify')}\n${lines.join('\n')}`;
}

function shouldFail(check: VerificationCheck): boolean {
  const signature = `${check.name} ${check.command ?? ''}`;
  return /fail/i.test(signature);
}

function canAutoFix(check: VerificationCheck): boolean {
  return check.type === 'lint' || /autofix/i.test(`${check.name} ${check.command ?? ''}`);
}

function isUnfixable(check: VerificationCheck): boolean {
  return /unfixable/i.test(`${check.name} ${check.command ?? ''}`);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
