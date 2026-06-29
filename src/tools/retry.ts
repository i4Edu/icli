import { theme } from '../ui/theme.js';

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'rate_limit', '429', '503', '500'],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const resolvedConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
    retryableErrors: config.retryableErrors ?? DEFAULT_RETRY_CONFIG.retryableErrors,
  };

  let attempt = 0;
  let lastError: unknown;

  while (attempt < resolvedConfig.maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      if (
        attempt >= resolvedConfig.maxAttempts ||
        !matchesRetryableError(error, resolvedConfig.retryableErrors)
      ) {
        throw error;
      }

      const waitMs = computeBackoffMs(attempt, resolvedConfig);
      process.stderr.write(
        theme.warn(
          `retry attempt ${attempt}/${resolvedConfig.maxAttempts} failed; waiting ${waitMs}ms before retrying...\n`,
        ),
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export function isRetryableError(error: unknown): boolean {
  return matchesRetryableError(error, DEFAULT_RETRY_CONFIG.retryableErrors);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (!error) return false;
  const err = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    status?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };

  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return false;

  const parts = [
    stringifyValue(err.code),
    stringifyValue(err.name),
    stringifyValue(err.message),
    stringifyValue(err.status),
    stringifyValue(err.response?.status),
  ];

  const cause = err.cause as
    | {
        code?: unknown;
        name?: unknown;
        message?: unknown;
        status?: unknown;
        response?: { status?: unknown };
      }
    | undefined;
  if (cause) {
    parts.push(
      stringifyValue(cause.code),
      stringifyValue(cause.name),
      stringifyValue(cause.message),
      stringifyValue(cause.status),
      stringifyValue(cause.response?.status),
    );
  }

  const normalized = parts
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  return retryableErrors.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function computeBackoffMs(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.backoffMs * config.backoffMultiplier ** Math.max(0, attempt - 1);
  const jitter = 1 + Math.random();
  return Math.max(0, Math.round(exponentialDelay * jitter));
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
