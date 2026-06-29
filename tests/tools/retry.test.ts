import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RETRY_CONFIG, isRetryableError, withRetry } from '../../src/tools/retry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isRetryableError', () => {
  it('matches retryable codes, statuses, and messages', () => {
    expect(
      isRetryableError(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })),
    ).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError(new Error('rate_limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
  });

  it('uses the documented default config', () => {
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'rate_limit', '429', '503', '500'],
    });
  });
});

describe('withRetry', () => {
  it('retries a transient failure and logs the attempt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fn = vi
      .fn(async () => 'ok')
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        backoffMs: 1,
        backoffMultiplier: 2,
      }),
    ).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('retry attempt 1/3 failed; waiting 1ms before retrying...'),
    );
  });

  it('stops after the max attempts and rethrows the last error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fn = vi
      .fn(async () => {
        throw new Error('upstream unavailable');
      })
      .mockRejectedValue(
        Object.assign(new Error('upstream unavailable'), {
          status: 503,
        }),
      );

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        backoffMs: 1,
        backoffMultiplier: 2,
      }),
    ).rejects.toThrow('upstream unavailable');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable failures', async () => {
    const fn = vi.fn(async () => {
      throw new Error('validation failed');
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        backoffMs: 1,
        backoffMultiplier: 2,
      }),
    ).rejects.toThrow('validation failed');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
