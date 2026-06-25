import { describe, expect, it } from 'vitest';
import { countTokens, countTokensSync, primeTokenizer } from '../../src/util/tokens.js';

describe('tokens', () => {
  it('uses a heuristic before the tokenizer is primed', () => {
    expect(countTokensSync('hello world')).toBe(Math.ceil('hello world'.length / 4));
  });

  it('uses the tokenizer after priming', async () => {
    await primeTokenizer();

    const count = countTokensSync('hello world');

    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens asynchronously', async () => {
    await expect(countTokens('hello')).resolves.toBeGreaterThan(0);
  });
});
