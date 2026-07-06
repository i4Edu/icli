import { theme } from '../ui/theme.js';

export interface RecoveryStrategy {
  id: string;
  name: string;
  type: 'backtrack' | 'alternative' | 'retry' | 'skip';
  conditions: string[];
  maxAttempts: number;
}

export interface RecoveryContext {
  error: string;
  failedStep: string;
  history: string[];
  availableStrategies: RecoveryStrategy[];
}

export interface RecoveryResult {
  strategy: RecoveryStrategy;
  success: boolean;
  attempts: number;
  output?: string;
  alternativePath?: string[];
}

interface StrategyOutcomeStats {
  attempts: number;
  successes: number;
}

const DEFAULT_SKIP_STRATEGY: RecoveryStrategy = {
  id: 'skip-default',
  name: 'Skip and continue',
  type: 'skip',
  conditions: [],
  maxAttempts: 1,
};

export class SelfRecoveryEngine {
  private readonly strategies = new Map<string, RecoveryStrategy>();
  private readonly outcomes = new Map<string, StrategyOutcomeStats>();

  addStrategy(strategy: RecoveryStrategy): void {
    this.strategies.set(strategy.id, { ...strategy, conditions: [...strategy.conditions] });
  }

  recover(context: RecoveryContext): RecoveryResult {
    const strategies = this.rankStrategies(context);

    for (const strategy of strategies) {
      let latestResult: RecoveryResult | undefined;

      for (let attempt = 1; attempt <= strategy.maxAttempts; attempt += 1) {
        latestResult = this.executeStrategy(strategy, context, attempt);
        this.recordOutcome(strategy.id, latestResult.success);
        if (latestResult.success) return latestResult;
      }

      if (latestResult) return latestResult;
    }

    return {
      strategy: DEFAULT_SKIP_STRATEGY,
      success: true,
      attempts: 1,
      output: `Skipped "${context.failedStep}" after exhausting recovery options.`,
      alternativePath: [...context.history, `Skip ${context.failedStep}`],
    };
  }

  backtrack(steps: string[]): string[] {
    return steps.slice(0, Math.max(steps.length - 1, 0));
  }

  findAlternative(failedStep: string, context: RecoveryContext): string[] {
    const decomposed = failedStep
      .split(/\b(?:and|then|after)\b|,|;/giu)
      .map((part) => part.trim())
      .filter(Boolean);

    if (decomposed.length > 1) {
      return [...context.history, ...decomposed.map((part) => rewriteAlternative(part))];
    }

    return [...context.history, rewriteAlternative(failedStep)];
  }

  getStrategies(): RecoveryStrategy[] {
    return [...this.strategies.values()].map((strategy) => ({
      ...strategy,
      conditions: [...strategy.conditions],
    }));
  }

  recordOutcome(strategyId: string, success: boolean): void {
    const current = this.outcomes.get(strategyId) ?? { attempts: 0, successes: 0 };
    current.attempts += 1;
    current.successes += success ? 1 : 0;
    this.outcomes.set(strategyId, current);
  }

  private rankStrategies(context: RecoveryContext): RecoveryStrategy[] {
    const merged = new Map<string, RecoveryStrategy>();
    for (const strategy of context.availableStrategies) merged.set(strategy.id, strategy);
    for (const strategy of this.strategies.values()) {
      if (!merged.has(strategy.id)) merged.set(strategy.id, strategy);
    }

    const ranked = [...merged.values()].sort((left, right) => {
      const leftScore = this.scoreStrategy(left, context);
      const rightScore = this.scoreStrategy(right, context);
      return rightScore - leftScore || left.name.localeCompare(right.name);
    });

    return ranked.length > 0 ? ranked : [DEFAULT_SKIP_STRATEGY];
  }

  private scoreStrategy(strategy: RecoveryStrategy, context: RecoveryContext): number {
    const haystack = normalize([context.error, context.failedStep, ...context.history].join(' '));
    const conditionHits = strategy.conditions.filter((condition) =>
      haystack.includes(normalize(condition)),
    ).length;
    const stats = this.outcomes.get(strategy.id);
    const historicalRate = stats && stats.attempts > 0 ? stats.successes / stats.attempts : 0.5;
    const transient = isTransientError(context.error);

    const typeBias =
      (strategy.type === 'retry' && transient ? 3 : 0) +
      (strategy.type === 'alternative' ? 1.5 : 0) +
      (strategy.type === 'backtrack' && context.history.length > 1 ? 1 : 0) +
      (strategy.type === 'skip' ? 0.25 : 0);

    return conditionHits * 2 + historicalRate + typeBias;
  }

  private executeStrategy(
    strategy: RecoveryStrategy,
    context: RecoveryContext,
    attempt: number,
  ): RecoveryResult {
    switch (strategy.type) {
      case 'retry': {
        const success = isTransientError(context.error);
        return {
          strategy,
          success,
          attempts: attempt,
          output: success
            ? `Retry attempt ${attempt} succeeded for "${context.failedStep}".`
            : `Retry attempt ${attempt} did not resolve "${context.failedStep}".`,
        };
      }
      case 'backtrack': {
        const alternativePath = this.backtrack(context.history);
        const success = alternativePath.length < context.history.length;
        return {
          strategy,
          success,
          attempts: attempt,
          output: success
            ? `Backtracked to ${alternativePath[alternativePath.length - 1] ?? 'the beginning'}.`
            : 'No earlier step was available for backtracking.',
          alternativePath,
        };
      }
      case 'alternative': {
        const alternativePath = this.findAlternative(context.failedStep, context);
        const success = alternativePath.length > context.history.length;
        return {
          strategy,
          success,
          attempts: attempt,
          output: success
            ? `Alternative path generated for "${context.failedStep}".`
            : `No viable alternative path found for "${context.failedStep}".`,
          alternativePath,
        };
      }
      case 'skip':
      default:
        return {
          strategy,
          success: true,
          attempts: attempt,
          output: `Skipped "${context.failedStep}" and continued with the remaining workflow.`,
          alternativePath: [...context.history, `Skip ${context.failedStep}`],
        };
    }
  }
}

export function formatRecoveryResult(result: RecoveryResult): string {
  const status = result.success ? theme.ok('success') : theme.err('failed');
  const lines = [
    `${theme.badge('RECOVER')} ${theme.assistant(result.strategy.name)} ${status}`,
    `${theme.dim('attempts:')} ${String(result.attempts)}`,
  ];

  if (result.output) {
    lines.push(`${theme.dim('output:')} ${result.output}`);
  }
  if (result.alternativePath && result.alternativePath.length > 0) {
    lines.push(`${theme.dim('path:')} ${result.alternativePath.join(' -> ')}`);
  }

  return lines.join('\n');
}

function rewriteAlternative(step: string): string {
  const normalized = normalize(step);
  if (normalized.startsWith('implement ')) return step.replace(/^implement\b/iu, 'Prototype');
  if (normalized.startsWith('build ')) return step.replace(/^build\b/iu, 'Inspect');
  if (normalized.startsWith('deploy ')) return step.replace(/^deploy\b/iu, 'Stage');
  if (normalized.startsWith('test ')) return step.replace(/^test\b/iu, 'Review');
  return `Alternative: ${step}`;
}

function isTransientError(error: string): boolean {
  return /\b(?:timeout|timed out|rate limit|network|temporary|unavailable|busy|429|econnreset)\b/iu.test(
    error,
  );
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
