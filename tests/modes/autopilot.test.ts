import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';

const runTurnMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/modes/turn.js', () => ({
  runTurn: runTurnMock,
}));

import {
  AUTOPILOT_MAX_STEPS,
  buildAutopilotSystemPrompt,
  parseAutopilotPlan,
  runAutopilot,
} from '../../src/modes/autopilot.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let output = '';

beforeEach(() => {
  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  runTurnMock.mockReset();
});

afterEach(() => {
  stdoutSpy.mockRestore();
});

describe('buildAutopilotSystemPrompt', () => {
  it('returns a prompt containing steps and the goal', () => {
    const goal = 'Refactor the command parser';
    const prompt = buildAutopilotSystemPrompt(goal);

    expect(prompt).toContain('steps');
    expect(prompt).toContain(goal);
  });
});

describe('parseAutopilotPlan', () => {
  it('parses a numbered list into structured steps', () => {
    const plan = parseAutopilotPlan(
      [
        'Goal: Ship autopilot mode',
        '1. Inspect the current command flow',
        '2. Add autopilot planner',
        '3. Verify tests pass',
      ].join('\n'),
    );

    expect(plan.goal).toBe('Goal: Ship autopilot mode');
    expect(plan.steps).toEqual([
      { description: 'Inspect the current command flow', status: 'pending' },
      { description: 'Add autopilot planner', status: 'pending' },
      { description: 'Verify tests pass', status: 'pending' },
    ]);
  });

  it('returns empty steps for an empty string', () => {
    expect(parseAutopilotPlan('')).toEqual({
      goal: '',
      steps: [],
    });
  });

  it('returns no steps for unnumbered text', () => {
    const plan = parseAutopilotPlan('Think through the task and report back.');

    expect(plan.goal).toBe('Think through the task and report back.');
    expect(plan.steps).toEqual([]);
  });
});

describe('runAutopilot', () => {
  it('loops until the model reports completion', async () => {
    const session = createSessionStub({ mode: 'plan', autopilotEnabled: true });
    let turnCount = 0;
    runTurnMock.mockImplementation(async ({ session: activeSession }: { session: Session }) => {
      turnCount += 1;
      activeSession.state.messages.push({
        role: 'assistant',
        content: turnCount === 2 ? 'AUTOPILOT_COMPLETE: Done.' : 'Still working.',
      });
    });

    const result = await runAutopilot('Ship the CLI wiring', {
      session,
      signal: new AbortController().signal,
      maxSteps: 3,
    });

    expect(result).toBe(session);
    expect(runTurnMock).toHaveBeenCalledTimes(2);
    expect(output).toContain('step 1 of 3');
    expect(output).toContain('step 2 of 3');
    expect(session.state.mode).toBe('plan');
    expect(session.state.autopilotEnabled).toBe(true);
    expect(session.state.systemPrompt).toBeUndefined();
  });

  it('stops at the configured maximum', async () => {
    runTurnMock.mockImplementation(async ({ session }: { session: Session }) => {
      session.state.messages.push({ role: 'assistant', content: 'Keep going.' });
    });

    await runAutopilot('Keep iterating', {
      signal: new AbortController().signal,
      maxSteps: 2,
      model: 'gpt-test',
      cwd: 'E:\\AI\\icli',
    });

    expect(runTurnMock).toHaveBeenCalledTimes(2);
    expect(output).toContain('autopilot stopped after 2 steps');
  });

  it('uses the built-in step cap', async () => {
    runTurnMock.mockImplementation(async ({ session }: { session: Session }) => {
      session.state.messages.push({ role: 'assistant', content: 'Keep going.' });
    });

    await runAutopilot('Respect the cap', {
      signal: new AbortController().signal,
      maxSteps: AUTOPILOT_MAX_STEPS + 5,
      model: 'gpt-test',
      cwd: 'E:\\AI\\icli',
    });

    expect(runTurnMock).toHaveBeenCalledTimes(AUTOPILOT_MAX_STEPS);
  });
});

function createSessionStub(
  init: Partial<Session['state']> = {},
): Session {
  const state = {
    id: 'session-1',
    createdAt: new Date().toISOString(),
    model: init.model ?? 'gpt-test',
    mode: init.mode ?? 'ask',
    cwd: init.cwd ?? 'E:\\AI\\icli',
    messages: init.messages ?? [],
    todos: init.todos ?? [],
    pinned: init.pinned ?? [],
    autopilotEnabled: init.autopilotEnabled ?? false,
    systemPrompt: init.systemPrompt,
  };

  return {
    state,
    setMode(nextMode) {
      state.mode = nextMode;
    },
    setAutopilotEnabled(enabled) {
      state.autopilotEnabled = enabled;
    },
    setSystemPrompt(prompt) {
      state.systemPrompt = prompt;
    },
  } as unknown as Session;
}
