import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import {
  getReasoningConfig,
  parseTokenBudget,
  setReasoningEffort,
  setThinkTokens,
} from '../../src/commands/reasoning-cmd.js';

const originalReasoningEffort = config.reasoningEffort;
const originalThinkTokens = config.thinkTokens;

afterEach(() => {
  config.reasoningEffort = originalReasoningEffort;
  config.thinkTokens = originalThinkTokens;
});

describe('parseTokenBudget', () => {
  it('parses binary shorthand and numeric budgets', () => {
    expect(parseTokenBudget('8k')).toBe(8192);
    expect(parseTokenBudget('0.5M')).toBe(524288);
    expect(parseTokenBudget('16384')).toBe(16384);
    expect(parseTokenBudget('0')).toBe(0);
  });
});

describe('reasoning config commands', () => {
  it('sets and reports reasoning effort levels', () => {
    setReasoningEffort('high');

    expect(config.reasoningEffort).toBe('high');
    expect(getReasoningConfig()).toMatchObject({ effort: 'high' });
  });

  it('updates think token config and supports disable', () => {
    setThinkTokens(8192);
    expect(config.thinkTokens).toBe(8192);
    expect(getReasoningConfig()).toMatchObject({ thinkTokens: 8192 });

    setThinkTokens(null);
    expect(config.thinkTokens).toBeUndefined();
    expect(getReasoningConfig().thinkTokens).toBeUndefined();
  });
});
