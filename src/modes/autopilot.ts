import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Session } from '../session/session.js';
import { hookManager } from '../hooks/lifecycle.js';
import { theme } from '../ui/theme.js';
import { Spinner } from '../ui/spinner.js';
import { selectMenu } from '../ui/select.js';
import { runTurn } from './turn.js';

export const AUTOPILOT_MAX_STEPS = 10;

const AUTOPILOT_REQUIRE_APPROVAL_DEFAULT = true;

export interface AutopilotOptions {
  /** @default 10 */
  maxSteps: number;
  /** @default true */
  requireApproval: boolean;
  signal: AbortSignal;
}

export interface RunAutopilotOptions extends Partial<AutopilotOptions> {
  model?: string;
  cwd?: string;
  session?: Session;
}

export type AutopilotStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type AutopilotStep = {
  description: string;
  status: AutopilotStepStatus;
  output?: string;
};

export type AutopilotPlan = {
  goal: string;
  steps: AutopilotStep[];
};

const AUTOPILOT_COMPLETE_TOKEN = 'AUTOPILOT_COMPLETE:';

export function buildAutopilotSystemPrompt(goal: string): string {
  const normalizedGoal = goal.trim();

  return [
    'You are operating in autopilot mode.',
    `Goal: ${normalizedGoal || 'No goal provided.'}`,
    '',
    'Follow this process:',
    '1. Break the goal into numbered steps.',
    '2. Execute each step using the available tools.',
    '3. Verify each step succeeded before moving to the next step.',
    '4. Report a final summary with results, blockers, and follow-up items.',
    '',
    `Constraints: keep the plan within ${AUTOPILOT_MAX_STEPS} steps unless the task clearly requires fewer.`,
    `Approval: assume destructive actions require explicit user approval when requireApproval=${String(AUTOPILOT_REQUIRE_APPROVAL_DEFAULT)}.`,
  ].join('\n');
}

export function parseAutopilotPlan(response: string): AutopilotPlan {
  const normalizedResponse = response.trim();

  if (!normalizedResponse) {
    return { goal: '', steps: [] };
  }

  const lines = normalizedResponse.split(/\r?\n/);
  const steps: AutopilotStep[] = [];
  const goalLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (match) {
      const description = match[2]?.trim();
      if (description) {
        steps.push({ description, status: 'pending' });
      }
      continue;
    }

    if (steps.length > 0) {
      const currentStep = steps[steps.length - 1];
      currentStep.description = `${currentStep.description} ${line}`.trim();
      continue;
    }

    goalLines.push(line);
  }

  const goal = goalLines.join(' ').trim();
  if (steps.length > 0) {
    return { goal, steps };
  }

  return {
    goal: normalizedResponse,
    steps: [],
  };
}

export async function runAutopilot(goal: string, opts: RunAutopilotOptions = {}): Promise<Session> {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) {
    throw new Error('autopilot requires a goal.');
  }

  const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? AUTOPILOT_MAX_STEPS, AUTOPILOT_MAX_STEPS));
  const signal = opts.signal ?? new AbortController().signal;
  const session =
    opts.session ??
    new Session({
      model: opts.model,
      cwd: opts.cwd,
      mode: 'ask',
    });
  if (!opts.session) {
    await session.initializeGitContext();
    await hookManager.emit('sessionStart', {
      sessionId: session.state.id,
      cwd: session.state.cwd,
      mode: session.state.mode,
      model: session.state.model,
    });
  }

  const previousMode = session.state.mode;
  const previousPrompt = session.state.systemPrompt;
  const previousAutopilotEnabled = Boolean(session.state.autopilotEnabled);

  session.setAutopilotEnabled(false);
  session.setMode('ask');
  session.setSystemPrompt(buildAutopilotSystemPrompt(normalizedGoal));

  const requireApproval = opts.requireApproval ?? AUTOPILOT_REQUIRE_APPROVAL_DEFAULT;

  try {
    for (let step = 1; step <= maxSteps; step++) {
      const spinner = new Spinner();
      spinner.start(`Step ${step} of ${maxSteps} …`);

      let stepError: unknown;
      try {
        await runTurn({
          session,
          userInput: buildAutopilotTurnPrompt(normalizedGoal, step, maxSteps),
          signal,
        });
      } catch (err) {
        stepError = err;
      }

      const success = stepError == null;
      spinner.stop(success);

      if (!success) {
        process.stdout.write(theme.err(`\n✖ step ${step} failed: ${(stepError as Error)?.message ?? stepError}\n`));
        break;
      }

      if (isAutopilotComplete(findLastAssistantMessage(session.state.messages))) {
        return session;
      }

      // When requireApproval is on, pause between steps so the user can review.
      if (requireApproval && step < maxSteps) {
        process.stdout.write('\n');
        const choice = await selectMenu([
          'Continue to next step',
          'Abort autopilot',
        ]);
        if (choice !== 0) {
          process.stdout.write(theme.dim('\nautopilot aborted by user.\n'));
          return session;
        }
      }
    }

    process.stdout.write(theme.warn(`\n⚠  autopilot stopped after ${maxSteps} steps.\n`));
    return session;
  } finally {
    session.setSystemPrompt(previousPrompt);
    session.setMode(previousMode);
    session.setAutopilotEnabled(previousAutopilotEnabled);
    if (!opts.session) {
      await hookManager.emit('sessionEnd', {
        sessionId: session.state.id,
        cwd: session.state.cwd,
        mode: session.state.mode,
        model: session.state.model,
      });
    }
  }
}

function buildAutopilotTurnPrompt(goal: string, step: number, maxSteps: number): string {
  const progress = `Step ${step} of ${maxSteps}.`;
  if (step === 1) {
    return [
      progress,
      `Goal: ${goal}`,
      `Start working now. When the goal is fully complete, begin your response with "${AUTOPILOT_COMPLETE_TOKEN}" followed by a concise summary.`,
    ].join('\n');
  }

  return [
    progress,
    'Continue from the current session state and finish the next best action.',
    `If the goal is fully complete, begin your response with "${AUTOPILOT_COMPLETE_TOKEN}" followed by a concise summary.`,
  ].join('\n');
}

function findLastAssistantMessage(messages: ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return contentToText(message.content);
    }
  }
  return '';
}

function isAutopilotComplete(content: string): boolean {
  return content.trimStart().startsWith(AUTOPILOT_COMPLETE_TOKEN);
}

function contentToText(content: ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      return 'text' in part && typeof part.text === 'string' ? part.text : '';
    })
    .join('\n');
}
