import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE, estimateCost, formatUsd, getRate } from '../../src/util/cost.js';

describe('cost utilities', () => {
  it('looks up rates by exact model name', () => {
    expect(getRate('gpt-4o')).toEqual({ input: 2.5, output: 10 });
  });

  it('looks up rates by case-insensitive prefix', () => {
    expect(getRate('GPT-4O-MINI-2024-07-18')).toEqual({ input: 0.15, output: 0.6 });
  });

  it('falls back for unknown models', () => {
    expect(getRate('unknown-model')).toBe(DEFAULT_RATE);
  });

  it('estimates input and output token cost', () => {
    expect(estimateCost('gpt-4o', 1000, 2000)).toBeCloseTo(22.5);
  });

  it('formats USD amounts', () => {
    expect(formatUsd(0)).toBe('$0.0000');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(0.00234)).toBe('$0.0023');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
