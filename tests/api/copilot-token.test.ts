import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copilotApiHeaders,
  getCopilotToken,
  resetCopilotTokenCache,
  type FetchLike,
} from '../../src/api/copilot-token.js';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

afterEach(() => {
  resetCopilotTokenCache();
  vi.restoreAllMocks();
});

describe('copilotApiHeaders', () => {
  it('includes the editor identity and integration headers', () => {
    const headers = copilotApiHeaders();
    expect(headers['Copilot-Integration-Id']).toBeTruthy();
    expect(headers['Editor-Version']).toMatch(/icopilot/);
  });
});

describe('getCopilotToken', () => {
  it('exchanges the github token and returns the copilot token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { token: 'tid=abc;exp=123', expires_at: Math.floor(Date.now() / 1000) + 1800 }),
    ) as unknown as FetchLike;

    const token = await getCopilotToken('gho_test', fetchImpl);
    expect(token).toBe('tid=abc;exp=123');

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('copilot_internal');
    expect(call[1].headers.Authorization).toBe('token gho_test');
  });

  it('caches the token and does not re-fetch before expiry', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { token: 'tok-1', expires_at: Math.floor(Date.now() / 1000) + 1800 }),
    ) as unknown as FetchLike;

    await getCopilotToken('gho_test', fetchImpl);
    await getCopilotToken('gho_test', fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('re-fetches when the source github token changes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 1800 }),
    ) as unknown as FetchLike;

    await getCopilotToken('gho_a', fetchImpl);
    await getCopilotToken('gho_b', fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('throws an actionable error on 401/403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, 'no copilot')) as unknown as FetchLike;
    await expect(getCopilotToken('gho_bad', fetchImpl)).rejects.toThrow(/Copilot access|subscription/i);
  });

  it('throws when no token is returned', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {})) as unknown as FetchLike;
    await expect(getCopilotToken('gho_x', fetchImpl)).rejects.toThrow(/no token/i);
  });
});
