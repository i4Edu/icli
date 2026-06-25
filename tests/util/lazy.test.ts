import { describe, expect, it } from 'vitest';
import { lazy } from '../../src/util/lazy.js';

describe('lazy', () => {
  it('invokes the loader once across concurrent callers', async () => {
    let calls = 0;
    const load = lazy(async () => {
      calls += 1;
      await Promise.resolve();
      return { value: 42 };
    });

    const [a, b, c] = await Promise.all([load(), load(), load()]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.value).toBe(42);
  });
});
