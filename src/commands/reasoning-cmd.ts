import { config, type ReasoningEffort } from '../config.js';

export function setReasoningEffort(level: ReasoningEffort): void {
  config.reasoningEffort = level;
}

export function setThinkTokens(budget: number | null): void {
  if (budget === null) {
    config.thinkTokens = undefined;
    return;
  }
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error('think token budget must be a non-negative number');
  }
  config.thinkTokens = Math.floor(budget);
}

export function parseTokenBudget(input: string): number {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!match) {
    throw new Error(`invalid token budget: ${input}`);
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`invalid token budget: ${input}`);
  }
  const suffix = match[2].toLowerCase();
  const multiplier = suffix === 'k' ? 1024 : suffix === 'm' ? 1024 * 1024 : 1;
  return Math.round(amount * multiplier);
}

export function getReasoningConfig(): { effort?: string; thinkTokens?: number } {
  return {
    ...(config.reasoningEffort ? { effort: config.reasoningEffort } : {}),
    ...(typeof config.thinkTokens === 'number' ? { thinkTokens: config.thinkTokens } : {}),
  };
}
