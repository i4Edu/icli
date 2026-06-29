import { Session, type Mode } from '../session/session.js';
import { runTurn, type TurnOpts } from '../modes/turn.js';
import { countTokensSync } from '../util/tokens.js';

export interface Goal {
  description: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  scope?: string[];
}

export interface GoalPlan {
  goal: Goal;
  steps: PlanStep[];
  estimatedTokens: number;
}

export interface PlanStep {
  id: string;
  description: string;
  type: 'analyze' | 'create' | 'modify' | 'test' | 'verify';
  files?: string[];
  dependencies?: string[];
}

export interface GoalStepResult {
  stepId: string;
  description: string;
  type: PlanStep['type'];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  output?: string;
  error?: string;
}

export interface VerificationResult {
  ok: boolean;
  score: number;
  issues: string[];
  attempts: number;
}

export interface GoalResult {
  goal: Goal;
  plan: GoalPlan;
  success: boolean;
  attempts: number;
  summary: string;
  aborted: boolean;
  stepResults: GoalStepResult[];
  verification: VerificationResult;
}

export interface GoalProgress {
  phase: 'idle' | 'planned' | 'executing' | 'verifying' | 'completed' | 'failed' | 'aborted';
  goal?: Goal;
  currentAttempt: number;
  maxAttempts: number;
  completedSteps: number;
  totalSteps: number;
  currentStepId?: string;
  verification?: VerificationResult;
  lastError?: string;
  result?: GoalResult;
}

export interface GoalDrivenAgentOptions {
  session?: Session;
  signal?: AbortSignal;
  maxRetries?: number;
  runTurn?: (opts: TurnOpts) => Promise<void>;
}

type SessionLike = Session &
  Partial<{
    setMode: (mode: Mode) => void;
    setSystemPrompt: (prompt?: string) => void;
  }>;

const DEFAULT_MAX_RETRIES = 3;

export class GoalDrivenAgent {
  readonly session: SessionLike;

  private readonly signal: AbortSignal;

  private readonly maxRetries: number;

  private readonly runTurnImpl: (opts: TurnOpts) => Promise<void>;

  private progress: GoalProgress = {
    phase: 'idle',
    currentAttempt: 0,
    maxAttempts: DEFAULT_MAX_RETRIES,
    completedSteps: 0,
    totalSteps: 0,
  };

  constructor(options: GoalDrivenAgentOptions = {}) {
    this.session = options.session ?? new Session();
    this.signal = options.signal ?? new AbortController().signal;
    this.maxRetries = clampRetries(options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.runTurnImpl = options.runTurn ?? runTurn;
    this.progress.maxAttempts = this.maxRetries;
  }

  plan(goal: Goal): GoalPlan {
    const normalizedGoal = normalizeGoal(goal);
    const files = collectFiles(normalizedGoal);
    const steps: PlanStep[] = [
      {
        id: 'analyze-goal',
        description: `Analyze the current implementation, constraints, and affected surfaces for: ${normalizedGoal.description}`,
        type: 'analyze',
        files,
      },
      {
        id: 'create-artifacts',
        description:
          'Create any new files, modules, or scaffolding required to deliver the goal end-to-end.',
        type: 'create',
        files,
        dependencies: ['analyze-goal'],
      },
      {
        id: 'modify-integrations',
        description:
          'Modify the existing integration points, command wiring, and supporting code needed by the goal.',
        type: 'modify',
        files,
        dependencies: ['create-artifacts'],
      },
      {
        id: 'test-goal',
        description: buildTestStepDescription(normalizedGoal),
        type: 'test',
        files,
        dependencies: ['modify-integrations'],
      },
      {
        id: 'verify-goal',
        description: buildVerifyStepDescription(normalizedGoal),
        type: 'verify',
        files,
        dependencies: ['test-goal'],
      },
    ];
    const estimatedTokens = safeTokenEstimate(
      [
        normalizedGoal.description,
        normalizedGoal.constraints?.join('\n') ?? '',
        normalizedGoal.acceptanceCriteria?.join('\n') ?? '',
        normalizedGoal.scope?.join('\n') ?? '',
        ...steps.map((step) => `${step.id}:${step.description}`),
      ].join('\n'),
    );

    this.progress = {
      phase: 'planned',
      goal: normalizedGoal,
      currentAttempt: 0,
      maxAttempts: this.maxRetries,
      completedSteps: 0,
      totalSteps: steps.length,
    };

    return {
      goal: normalizedGoal,
      steps,
      estimatedTokens,
    };
  }

  async execute(plan: GoalPlan): Promise<GoalResult> {
    this.progress = {
      ...this.progress,
      phase: 'executing',
      goal: plan.goal,
      currentAttempt: 0,
      completedSteps: 0,
      totalSteps: plan.steps.length,
      currentStepId: undefined,
      lastError: undefined,
      result: undefined,
      verification: undefined,
    };

    const previousMode = this.session.state.mode;
    const previousPrompt = this.session.state.systemPrompt;
    setSessionMode(this.session, 'ask');
    setSystemPrompt(this.session, buildGoalSystemPrompt(plan.goal));

    let lastResult: GoalResult | null = null;
    let retryFeedback: string[] = [];

    try {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        const stepResults = createStepResults(plan.steps, attempt);
        this.progress.currentAttempt = attempt;
        this.progress.phase = 'executing';
        this.progress.completedSteps = 0;
        this.progress.currentStepId = undefined;
        this.progress.lastError = undefined;

        let aborted = false;

        for (let index = 0; index < plan.steps.length; index++) {
          const step = plan.steps[index]!;
          const stepResult = stepResults[index]!;
          this.progress.currentStepId = step.id;
          stepResult.status = 'running';

          try {
            throwIfAborted(this.signal);
            await this.runTurnImpl({
              session: this.session,
              userInput: buildGoalStepPrompt(plan, step, attempt, this.maxRetries, retryFeedback),
              signal: this.signal,
            });
            stepResult.status = 'completed';
            stepResult.output = findLastAssistantMessage(this.session.state.messages);
            this.progress.completedSteps += 1;
          } catch (error) {
            if (isAbortError(error) || this.signal.aborted) {
              aborted = true;
              stepResult.status = 'skipped';
              stepResult.error = 'Goal execution was aborted.';
              break;
            }
            stepResult.status = 'failed';
            stepResult.error = error instanceof Error ? error.message : String(error);
            this.progress.lastError = stepResult.error;
            break;
          }
        }

        this.progress.phase = aborted ? 'aborted' : 'verifying';
        const summary = summarizeResult(plan.goal, stepResults, attempt, aborted);
        const result: GoalResult = {
          goal: plan.goal,
          plan,
          success: false,
          attempts: attempt,
          summary,
          aborted,
          stepResults,
          verification: {
            ok: false,
            score: 0,
            issues: [],
            attempts: attempt,
          },
        };
        const verification = this.verify(plan.goal, result);
        result.verification = verification;
        result.success = verification.ok;
        this.progress.verification = verification;
        this.progress.result = result;
        lastResult = result;

        if (aborted) {
          this.progress.phase = 'aborted';
          return result;
        }
        if (verification.ok) {
          this.progress.phase = 'completed';
          return result;
        }

        retryFeedback = verification.issues;
        this.progress.phase = attempt >= this.maxRetries ? 'failed' : 'executing';
      }
    } finally {
      setSystemPrompt(this.session, previousPrompt);
      setSessionMode(this.session, previousMode);
    }

    if (lastResult) {
      this.progress.result = lastResult;
      return lastResult;
    }

    const fallbackPlan = plan.steps.length > 0 ? plan : this.plan(plan.goal);
    const fallbackResult: GoalResult = {
      goal: plan.goal,
      plan: fallbackPlan,
      success: false,
      attempts: this.progress.currentAttempt,
      summary: 'Goal execution did not run.',
      aborted: false,
      stepResults: createStepResults(fallbackPlan.steps, this.progress.currentAttempt || 1),
      verification: {
        ok: false,
        score: 0,
        issues: ['Goal execution did not run.'],
        attempts: this.progress.currentAttempt || 1,
      },
    };
    this.progress.phase = 'failed';
    this.progress.result = fallbackResult;
    this.progress.verification = fallbackResult.verification;
    return fallbackResult;
  }

  verify(goal: Goal, result: GoalResult): VerificationResult {
    const issues: string[] = [];
    if (result.aborted) {
      issues.push('Goal execution was aborted before completion.');
    }

    const failedSteps = result.stepResults.filter((step) => step.status === 'failed');
    for (const step of failedSteps) {
      issues.push(`Step "${step.description}" failed${step.error ? `: ${step.error}` : '.'}`);
    }

    const completedSteps = result.stepResults.filter((step) => step.status === 'completed');
    if (completedSteps.length === 0) {
      issues.push('No goal step completed successfully.');
    }

    if ((goal.acceptanceCriteria?.length ?? 0) > 0) {
      const hasValidationStep = result.plan.steps.some(
        (step) => step.type === 'test' || step.type === 'verify',
      );
      if (!hasValidationStep) {
        issues.push('The plan does not include a validation step for the acceptance criteria.');
      }
    }

    const hasVerifyCompletion = result.stepResults.some(
      (step) => step.type === 'verify' && step.status === 'completed',
    );
    if (!hasVerifyCompletion) {
      issues.push('The verification step did not complete successfully.');
    }

    const scoreBase =
      result.plan.steps.length > 0 ? completedSteps.length / result.plan.steps.length : 0;
    const score = Math.max(
      0,
      Math.min(1, Math.round((scoreBase - issues.length * 0.08) * 100) / 100),
    );

    return {
      ok: issues.length === 0,
      score,
      issues,
      attempts: result.attempts,
    };
  }

  getProgress(): GoalProgress {
    return {
      ...this.progress,
      verification: this.progress.verification
        ? {
            ...this.progress.verification,
            issues: [...this.progress.verification.issues],
          }
        : undefined,
      result: this.progress.result
        ? {
            ...this.progress.result,
            stepResults: this.progress.result.stepResults.map((step) => ({ ...step })),
            verification: {
              ...this.progress.result.verification,
              issues: [...this.progress.result.verification.issues],
            },
          }
        : undefined,
    };
  }
}

function normalizeGoal(goal: Goal): Goal {
  return {
    description: goal.description.trim(),
    constraints: normalizeStringList(goal.constraints),
    acceptanceCriteria: normalizeStringList(goal.acceptanceCriteria),
    scope: normalizeStringList(goal.scope),
  };
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function collectFiles(goal: Goal): string[] | undefined {
  const files = new Set<string>();
  for (const entry of goal.scope ?? []) {
    const normalized = entry.trim();
    if (/\.[a-z0-9]+$/i.test(normalized) || normalized.includes('/') || normalized.includes('\\')) {
      files.add(normalized);
    }
  }
  return files.size > 0 ? [...files] : undefined;
}

function buildTestStepDescription(goal: Goal): string {
  const criteria =
    goal.acceptanceCriteria && goal.acceptanceCriteria.length > 0
      ? `Validate these acceptance criteria: ${goal.acceptanceCriteria.join('; ')}.`
      : 'Run or update the most relevant automated and manual checks for the goal.';
  return `${criteria} Fix any gaps before proceeding.`;
}

function buildVerifyStepDescription(goal: Goal): string {
  const constraints =
    goal.constraints && goal.constraints.length > 0
      ? ` Re-check constraints: ${goal.constraints.join('; ')}.`
      : '';
  return `Verify the end-to-end outcome, summarize the changes made, and confirm the goal is complete.${constraints}`;
}

function safeTokenEstimate(text: string): number {
  try {
    return countTokensSync(text);
  } catch {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}

function createStepResults(steps: PlanStep[], attempt: number): GoalStepResult[] {
  return steps.map((step) => ({
    stepId: step.id,
    description: step.description,
    type: step.type,
    status: 'pending',
    attempts: attempt,
  }));
}

function buildGoalSystemPrompt(goal: Goal): string {
  const lines = [
    'You are a goal-driven implementation agent.',
    'Plan, implement, test, and verify the requested feature end-to-end.',
    'Use the available tools to inspect code, make changes, run tests, and confirm the result.',
    'Keep changes aligned to the stated scope and constraints.',
    '',
    `Goal: ${goal.description}`,
  ];

  if (goal.scope?.length) {
    lines.push(`Scope: ${goal.scope.join('; ')}`);
  }
  if (goal.constraints?.length) {
    lines.push(`Constraints: ${goal.constraints.join('; ')}`);
  }
  if (goal.acceptanceCriteria?.length) {
    lines.push(`Acceptance criteria: ${goal.acceptanceCriteria.join('; ')}`);
  }

  return lines.join('\n');
}

function buildGoalStepPrompt(
  plan: GoalPlan,
  step: PlanStep,
  attempt: number,
  maxAttempts: number,
  retryFeedback: string[],
): string {
  const lines = [
    `Goal attempt ${attempt} of ${maxAttempts}.`,
    `Goal: ${plan.goal.description}`,
    `Current step (${step.type}): ${step.description}`,
  ];

  if (step.files?.length) {
    lines.push(`Relevant files: ${step.files.join(', ')}`);
  }
  if (step.dependencies?.length) {
    lines.push(`Step dependencies already satisfied: ${step.dependencies.join(', ')}`);
  }
  if (retryFeedback.length > 0) {
    lines.push(`Retry guidance: ${retryFeedback.join(' | ')}`);
  }
  if (plan.goal.acceptanceCriteria?.length) {
    lines.push(`Acceptance criteria: ${plan.goal.acceptanceCriteria.join('; ')}`);
  }
  if (plan.goal.constraints?.length) {
    lines.push(`Constraints: ${plan.goal.constraints.join('; ')}`);
  }

  lines.push('Do the work for this step now and report the concrete outcome.');
  return lines.join('\n');
}

function summarizeResult(
  goal: Goal,
  stepResults: GoalStepResult[],
  attempt: number,
  aborted: boolean,
): string {
  const completed = stepResults.filter((step) => step.status === 'completed').length;
  const failed = stepResults.filter((step) => step.status === 'failed').length;
  const skipped = stepResults.filter((step) => step.status === 'skipped').length;
  const status = aborted ? 'aborted' : failed > 0 ? 'failed' : 'completed';
  return `${goal.description} — ${status} on attempt ${attempt} (${completed} completed, ${failed} failed, ${skipped} skipped).`;
}

function findLastAssistantMessage(messages: Session['state']['messages']): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          return 'text' in part && typeof part.text === 'string' ? part.text : '';
        })
        .join('\n');
    }
  }
  return '';
}

function setSessionMode(session: SessionLike, mode: Mode): void {
  if (typeof session.setMode === 'function') {
    session.setMode(mode);
    return;
  }
  session.state.mode = mode;
}

function setSystemPrompt(session: SessionLike, prompt?: string): void {
  if (typeof session.setSystemPrompt === 'function') {
    session.setSystemPrompt(prompt);
    return;
  }
  session.state.systemPrompt = prompt;
}

function clampRetries(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RETRIES;
  return Math.max(1, Math.min(Math.trunc(value), DEFAULT_MAX_RETRIES));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError'),
  );
}
