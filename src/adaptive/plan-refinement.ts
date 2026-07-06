import { theme } from '../ui/theme.js';

export interface RefinementStep {
  iteration: number;
  plan: string[];
  feedback: string[];
  confidence: number;
}

export interface RefinementConfig {
  maxIterations: number;
  confidenceThreshold: number;
  strategy: 'iterative' | 'recursive' | 'hybrid';
}

export interface RefinementResult {
  finalPlan: string[];
  iterations: number;
  confidence: number;
  history: RefinementStep[];
}

const DEFAULT_REFINEMENT_CONFIG: RefinementConfig = {
  maxIterations: 5,
  confidenceThreshold: 0.8,
  strategy: 'hybrid',
};

const ACTION_VERBS = new Set([
  'analyze',
  'audit',
  'build',
  'check',
  'create',
  'debug',
  'define',
  'deploy',
  'design',
  'document',
  'evaluate',
  'implement',
  'inspect',
  'integrate',
  'measure',
  'prepare',
  'refine',
  'review',
  'test',
  'validate',
  'verify',
]);

const VALIDATION_TERMS = ['test', 'validate', 'verify', 'check', 'review'];

export class PlanRefiner {
  refine(
    initialPlan: string[],
    context: string,
    config: Partial<RefinementConfig> = {},
  ): RefinementResult {
    const effectiveConfig = { ...DEFAULT_REFINEMENT_CONFIG, ...config };
    let plan = this.merge(initialPlan);
    const history: RefinementStep[] = [];

    for (let iteration = 1; iteration <= effectiveConfig.maxIterations; iteration += 1) {
      const confidence = this.evaluateConfidence(plan, context);
      const feedback = this.collectFeedback(plan, context);
      history.push({
        iteration,
        plan: [...plan],
        feedback,
        confidence,
      });

      if (confidence >= effectiveConfig.confidenceThreshold || feedback.length === 0) {
        return {
          finalPlan: plan,
          iterations: iteration,
          confidence,
          history,
        };
      }

      plan = this.applyStrategy(plan, context, effectiveConfig.strategy, feedback);
    }

    const confidence = this.evaluateConfidence(plan, context);
    return {
      finalPlan: plan,
      iterations: history.length,
      confidence,
      history,
    };
  }

  evaluateConfidence(plan: string[], context: string): number {
    const steps = this.merge(plan);
    if (!steps.length) return 0;

    const contextKeywords = extractKeywords(context);
    const coveredKeywords = contextKeywords.filter((keyword) =>
      steps.some((step) => normalize(step).includes(keyword)),
    );
    const coverage = contextKeywords.length ? coveredKeywords.length / contextKeywords.length : 1;

    const actionable =
      steps.filter((step) => ACTION_VERBS.has(firstToken(step)) || tokenize(step).length >= 3)
        .length / steps.length;

    const granularity =
      steps.reduce((score, step) => score + granularityScore(step), 0) / Math.max(steps.length, 1);

    const validation = steps.some((step) => hasValidationLanguage(step)) ? 1 : 0.35;

    return round(clamp(coverage * 0.35 + actionable * 0.25 + granularity * 0.2 + validation * 0.2));
  }

  decompose(step: string): string[] {
    const fragments = step
      .split(/\b(?:and|then|after that|followed by)\b|,|;|->/giu)
      .map((fragment) => fragment.trim())
      .filter(Boolean);

    if (fragments.length <= 1) return [step.trim()];
    return this.merge(
      fragments.map((fragment, index) =>
        ACTION_VERBS.has(firstToken(fragment))
          ? fragment
          : `${index === 0 ? 'Analyze' : 'Handle'} ${fragment}`.trim(),
      ),
    );
  }

  merge(steps: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const step of steps) {
      const normalizedStep = normalizeSpacing(step);
      if (!normalizedStep) continue;
      const key = normalize(normalizedStep);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(normalizedStep);
    }

    return merged;
  }

  private applyStrategy(
    plan: string[],
    context: string,
    strategy: RefinementConfig['strategy'],
    feedback: string[],
  ): string[] {
    const broadSteps = plan.filter((step) => isBroadStep(step));
    const refinedSteps =
      strategy === 'iterative'
        ? plan.flatMap((step) => (isBroadStep(step) ? this.decompose(step) : [step]))
        : strategy === 'recursive'
          ? this.refineRecursively(plan, broadSteps[0])
          : this.refineRecursively(
              plan.flatMap((step) => (isBroadStep(step) ? this.decompose(step) : [step])),
              broadSteps[0],
            );

    const nextPlan = [...refinedSteps];
    const contextKeywords = extractKeywords(context);
    const uncovered = contextKeywords.filter(
      (keyword) => !nextPlan.some((step) => normalize(step).includes(keyword)),
    );

    if (uncovered.length > 0) {
      nextPlan.push(`Incorporate ${uncovered.slice(0, 3).join(', ')} requirements into the plan`);
    }

    if (!nextPlan.some((step) => hasValidationLanguage(step))) {
      const summary = contextKeywords.slice(0, 4).join(', ') || 'the requested outcome';
      nextPlan.push(`Validate the result against ${summary}`);
    }

    if (feedback.some((item) => item.includes('structure')) && nextPlan.length < 2) {
      nextPlan.push('Document the implementation checkpoints');
    }

    return this.merge(nextPlan);
  }

  private refineRecursively(plan: string[], broadStep: string | undefined): string[] {
    if (!broadStep) return this.merge(plan);
    const refined: string[] = [];

    for (const step of plan) {
      if (step === broadStep) {
        refined.push(...this.decompose(step).flatMap((fragment) => this.decompose(fragment)));
      } else {
        refined.push(step);
      }
    }

    return this.merge(refined);
  }

  private collectFeedback(plan: string[], context: string): string[] {
    const feedback: string[] = [];
    const keywords = extractKeywords(context);
    const uncovered = keywords.filter(
      (keyword) => !plan.some((step) => normalize(step).includes(keyword)),
    );

    if (plan.length < 2) {
      feedback.push('Add more structure so the plan has multiple actionable checkpoints.');
    }
    if (plan.some((step) => isBroadStep(step))) {
      feedback.push('Decompose broad steps into smaller actions.');
    }
    if (!plan.some((step) => hasValidationLanguage(step))) {
      feedback.push('Add validation or verification to the plan.');
    }
    if (uncovered.length > 0) {
      feedback.push(`Cover missing context signals: ${uncovered.slice(0, 3).join(', ')}.`);
    }

    return feedback;
  }
}

export function formatRefinementResult(result: RefinementResult): string {
  const lines = [
    `${theme.badge('REFINE')} ${theme.assistant(`confidence ${Math.round(result.confidence * 100)}%`)}`,
    `${theme.dim('iterations:')} ${String(result.iterations)}`,
    `${theme.dim('final plan:')}`,
    ...result.finalPlan.map((step, index) => `  ${theme.hl(`${index + 1}.`)} ${step}`),
  ];

  if (result.history.length > 0) {
    const feedback = result.history[result.history.length - 1]?.feedback ?? [];
    if (feedback.length > 0) {
      lines.push(`${theme.dim('latest feedback:')}`);
      lines.push(...feedback.map((item) => `  ${theme.warn('•')} ${item}`));
    }
  }

  return lines.join('\n');
}

function extractKeywords(input: string): string[] {
  const stopWords = new Set([
    'about',
    'against',
    'also',
    'build',
    'create',
    'from',
    'into',
    'that',
    'their',
    'them',
    'then',
    'this',
    'with',
    'your',
  ]);

  return [...new Set(tokenize(input).filter((token) => token.length > 3 && !stopWords.has(token)))];
}

function tokenize(input: string): string[] {
  return normalize(input).split(/\s+/u).filter(Boolean);
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeSpacing(input: string): string {
  return input.replace(/\s+/gu, ' ').trim();
}

function firstToken(step: string): string {
  return tokenize(step)[0] ?? '';
}

function isBroadStep(step: string): boolean {
  const words = tokenize(step);
  return words.length > 8 || /\b(?:and|then|after|before)\b/iu.test(step);
}

function hasValidationLanguage(step: string): boolean {
  return VALIDATION_TERMS.some((term) => normalize(step).includes(term));
}

function granularityScore(step: string): number {
  const length = tokenize(step).length;
  if (length >= 3 && length <= 10) return 1;
  if (length === 2 || (length >= 11 && length <= 14)) return 0.65;
  return 0.35;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
