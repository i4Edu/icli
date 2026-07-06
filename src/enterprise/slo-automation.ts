import { theme } from '../ui/theme.js';

export interface SLO {
  id: string;
  name: string;
  target: number;
  metric: string;
  window: '1h' | '1d' | '7d' | '30d';
  runbook?: string;
}

export interface SLOStatus {
  slo: SLO;
  current: number;
  budget: number;
  budgetRemaining: number;
  breached: boolean;
}

export interface Runbook {
  id: string;
  name: string;
  steps: RunbookStep[];
  triggers: string[];
}

export interface RunbookStep {
  id: string;
  action: string;
  params: Record<string, unknown>;
  onFail: 'stop' | 'continue' | 'escalate';
}

export interface RunbookExecution {
  runbookId: string;
  status: 'complete' | 'failed' | 'escalated';
  steps: Array<{
    stepId: string;
    action: string;
    success: boolean;
    message?: string;
  }>;
}

export interface SLOAutomationOptions {
  slos?: SLO[];
  runbooks?: Runbook[];
  metricProvider?: (metric: string, window: SLO['window']) => number;
  stepExecutor?: (step: RunbookStep, context: Record<string, unknown>) => boolean | string;
}

export class SLOAutomation {
  private readonly slos = new Map<string, SLO>();
  private readonly runbooks = new Map<string, Runbook>();
  private readonly metricProvider: (metric: string, window: SLO['window']) => number;
  private readonly stepExecutor: (
    step: RunbookStep,
    context: Record<string, unknown>,
  ) => boolean | string;

  constructor(options: SLOAutomationOptions = {}) {
    this.metricProvider = options.metricProvider ?? (() => 100);
    this.stepExecutor = options.stepExecutor ?? (() => true);
    for (const slo of options.slos ?? []) {
      this.addSLO(slo);
    }
    for (const runbook of options.runbooks ?? []) {
      this.runbooks.set(runbook.id, normalizeRunbook(runbook));
    }
  }

  addSLO(slo: SLO): SLO {
    const normalized = normalizeSLO(slo);
    this.slos.set(normalized.id, normalized);
    return cloneSLO(normalized);
  }

  removeSLO(id: string): boolean {
    return this.slos.delete(id.trim());
  }

  checkStatus(id?: string): SLOStatus[] {
    const slos = id ? [this.requireSLO(id)] : [...this.slos.values()];
    return slos.map((slo) => {
      const current = clampPercentage(this.metricProvider(slo.metric, slo.window));
      const budget = clampPercentage(100 - slo.target);
      const consumedBudget = clampPercentage(Math.max(0, slo.target - current));
      const budgetRemaining = clampPercentage(Math.max(0, budget - consumedBudget));
      return {
        slo: cloneSLO(slo),
        current,
        budget,
        budgetRemaining,
        breached: current < slo.target,
      };
    });
  }

  executeRunbook(runbookId: string, context: Record<string, unknown> = {}): RunbookExecution {
    const runbook = this.runbooks.get(runbookId.trim());
    if (!runbook) {
      throw new Error(`runbook not found: ${runbookId}`);
    }

    const steps: RunbookExecution['steps'] = [];
    let status: RunbookExecution['status'] = 'complete';

    for (const step of runbook.steps) {
      const result = this.stepExecutor(step, cloneContext(context));
      const success = result === true;
      const message = typeof result === 'string' ? result : undefined;
      steps.push({
        stepId: step.id,
        action: step.action,
        success,
        message,
      });
      if (success) continue;
      if (step.onFail === 'continue') continue;
      status = step.onFail === 'escalate' ? 'escalated' : 'failed';
      break;
    }

    return {
      runbookId: runbook.id,
      status,
      steps,
    };
  }

  listSLOs(): SLO[] {
    return [...this.slos.values()]
      .map(cloneSLO)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getBreached(): SLOStatus[] {
    return this.checkStatus().filter((status) => status.breached);
  }

  private requireSLO(id: string): SLO {
    const slo = this.slos.get(id.trim());
    if (!slo) {
      throw new Error(`slo not found: ${id}`);
    }
    return slo;
  }
}

export function formatSLOStatus(statuses: SLOStatus[]): string {
  if (statuses.length === 0) {
    return `${theme.brand('SLO status')}\n  ${theme.dim('No SLOs configured.')}\n`;
  }

  const lines = [theme.brand('SLO status'), ''];
  for (const status of statuses) {
    const state = status.breached ? theme.err('breached') : theme.ok('healthy');
    lines.push(`  ${theme.hl(status.slo.name)} ${state} ${theme.dim(`(${status.slo.window})`)}`);
    lines.push(
      `    current: ${status.current.toFixed(2)}  target: ${status.slo.target.toFixed(2)}  budget remaining: ${status.budgetRemaining.toFixed(2)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function normalizeSLO(slo: SLO): SLO {
  return {
    id: requireValue(slo.id, 'slo id'),
    name: requireValue(slo.name, 'slo name'),
    target: clampPercentage(slo.target),
    metric: requireValue(slo.metric, 'slo metric'),
    window: slo.window,
    runbook:
      typeof slo.runbook === 'string' && slo.runbook.trim().length > 0
        ? slo.runbook.trim()
        : undefined,
  };
}

function normalizeRunbook(runbook: Runbook): Runbook {
  return {
    id: requireValue(runbook.id, 'runbook id'),
    name: requireValue(runbook.name, 'runbook name'),
    triggers: [
      ...new Set(runbook.triggers.map((trigger) => requireValue(trigger, 'runbook trigger'))),
    ],
    steps: runbook.steps.map((step) => ({
      id: requireValue(step.id, 'runbook step id'),
      action: requireValue(step.action, 'runbook action'),
      params: cloneContext(step.params),
      onFail: step.onFail,
    })),
  };
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function cloneSLO(slo: SLO): SLO {
  return { ...slo };
}

function cloneContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context));
}
