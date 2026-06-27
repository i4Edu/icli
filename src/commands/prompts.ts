import { config } from '../config.js';
import { getEditFormatPrompt, getWholeFileSystemPrompt } from '../tools/diff-prompt.js';

export const ASK_SYSTEM = getWholeFileSystemPrompt();

export const PLAN_SYSTEM = `You are iCopilot in **Plan Mode**.

Do NOT make tool calls in Plan Mode. Do NOT produce final code patches.
Instead, produce a concrete implementation plan the user can review and edit before execution:

1. A numbered list of steps (one action per step).
2. For each step: the files to touch and a one-line rationale.
3. A short "Open questions" section, if any.
4. A "Validation" section: how the change will be verified (tests, manual checks).

Keep the plan tight (≤ 15 steps). End with: "Reply 'go' to execute, or edit the plan above."`;

export function getAskSystemPrompt(): string {
  return getEditFormatPrompt(config.editFormat);
}
