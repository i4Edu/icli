import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';
import {
  GoalDrivenAgent,
  type Goal,
  type GoalPlan,
  type GoalResult,
  type VerificationResult,
} from '../../src/agents/goal-driven.js';

describe('GoalDrivenAgent', () => {
  it('builds a deterministic end-to-end plan', () => {
    const agent = new GoalDrivenAgent({
      session: createSessionStub(),
      runTurn: vi.fn(),
    });

    const plan = agent.plan({
      description: 'Implement /goal end-to-end execution',
      acceptanceCriteria: ['Support /goal status', 'Support /goal abort'],
      scope: ['src/commands/slash.ts', 'src/util/completion.ts'],
    });

    expect(plan.goal.description).toBe('Implement /goal end-to-end execution');
    expect(plan.steps.map((step) => step.type)).toEqual([
      'analyze',
      'create',
      'modify',
      'test',
      'verify',
    ]);
    expect(plan.steps[1]?.dependencies).toEqual(['analyze-goal']);
    expect(plan.steps[2]?.dependencies).toEqual(['create-artifacts']);
    expect(plan.steps[2]?.files).toEqual(['src/commands/slash.ts', 'src/util/completion.ts']);
    expect(plan.estimatedTokens).toBeGreaterThan(0);

    const progress = agent.getProgress();
    expect(progress.phase).toBe('planned');
    expect(progress.totalSteps).toBe(5);
  });

  it('retries execution until verification passes', async () => {
    const runTurnMock = vi.fn(
      async ({ session, userInput }: { session: Session; userInput: string }) => {
        session.state.messages.push({
          role: 'assistant',
          content: `completed: ${userInput}`,
        });
      },
    );
    const plan = buildPlan({
      description: 'Ship the goal-driven workflow',
      acceptanceCriteria: ['Runs through plan, execute, verify'],
    });
    const agent = new RetryingGoalDrivenAgent([false, true], {
      session: createSessionStub(),
      runTurn: runTurnMock,
      maxRetries: 3,
    });

    const result = await agent.execute(plan);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(runTurnMock).toHaveBeenCalledTimes(plan.steps.length * 2);
    expect(result.verification.ok).toBe(true);
    expect(agent.getProgress().phase).toBe('completed');
  });

  it('marks the run as aborted when the signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const runTurnMock = vi.fn();
    const agent = new GoalDrivenAgent({
      session: createSessionStub(),
      runTurn: runTurnMock,
      signal: controller.signal,
    });

    const result = await agent.execute(
      buildPlan({
        description: 'Abort before the first step',
      }),
    );

    expect(result.aborted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.verification.ok).toBe(false);
    expect(runTurnMock).not.toHaveBeenCalled();
    expect(agent.getProgress().phase).toBe('aborted');
  });

  it('reports verification issues for incomplete plans', () => {
    const agent = new GoalDrivenAgent({
      session: createSessionStub(),
      runTurn: vi.fn(),
    });
    const goal: Goal = {
      description: 'Verify an incomplete implementation',
      acceptanceCriteria: ['Include verification coverage'],
    };
    const plan: GoalPlan = {
      goal,
      estimatedTokens: 12,
      steps: [
        {
          id: 'analyze-goal',
          description: 'Analyze the goal.',
          type: 'analyze',
        },
        {
          id: 'modify-integrations',
          description: 'Modify existing code.',
          type: 'modify',
          dependencies: ['analyze-goal'],
        },
      ],
    };
    const result: GoalResult = {
      goal,
      plan,
      success: false,
      attempts: 1,
      summary: 'Incomplete.',
      aborted: false,
      stepResults: [
        {
          stepId: 'analyze-goal',
          description: 'Analyze the goal.',
          type: 'analyze',
          status: 'completed',
          attempts: 1,
        },
        {
          stepId: 'modify-integrations',
          description: 'Modify existing code.',
          type: 'modify',
          status: 'failed',
          attempts: 1,
          error: 'boom',
        },
      ],
      verification: {
        ok: false,
        score: 0,
        issues: [],
        attempts: 1,
      },
    };

    const verification = agent.verify(goal, result);

    expect(verification.ok).toBe(false);
    expect(verification.issues).toContain(
      'The plan does not include a validation step for the acceptance criteria.',
    );
    expect(verification.issues).toContain('The verification step did not complete successfully.');
    expect(verification.issues.some((issue) => issue.includes('failed'))).toBe(true);
  });
});

class RetryingGoalDrivenAgent extends GoalDrivenAgent {
  constructor(
    private readonly outcomes: boolean[],
    options: ConstructorParameters<typeof GoalDrivenAgent>[0],
  ) {
    super(options);
  }

  override verify(goal: Goal, result: GoalResult): VerificationResult {
    const passed = this.outcomes.shift() ?? true;
    const base = super.verify(goal, result);
    return {
      ...base,
      ok: passed && base.issues.length === 0,
      score: passed && base.issues.length === 0 ? 1 : 0.5,
      issues: passed && base.issues.length === 0 ? [] : ['Retry requested by verifier.'],
    };
  }
}

function buildPlan(goal: Goal): GoalPlan {
  const planner = new GoalDrivenAgent({
    session: createSessionStub(),
    runTurn: vi.fn(),
  });
  return planner.plan(goal);
}

function createSessionStub(init: Partial<Session['state']> = {}): Session {
  const state = {
    id: 'session-goal',
    createdAt: new Date().toISOString(),
    model: init.model ?? 'gpt-test',
    mode: init.mode ?? 'ask',
    cwd: init.cwd ?? 'E:\\AI\\icli',
    messages: init.messages ?? [],
    todos: init.todos ?? [],
    pinned: init.pinned ?? [],
    gitContext: init.gitContext ?? [],
    autopilotEnabled: init.autopilotEnabled ?? false,
    systemPrompt: init.systemPrompt,
  };

  return {
    state,
    setMode(nextMode) {
      state.mode = nextMode;
    },
    setSystemPrompt(prompt) {
      state.systemPrompt = prompt;
    },
  } as unknown as Session;
}
