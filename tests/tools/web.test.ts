import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebFetchPolicy } from '../../src/tools/web.js';

describe('hostAllowed', () => {
  it('allows wildcard suffix matches', async () => {
    const { hostAllowed } = await import('../../src/tools/web.js');
    const policy: WebFetchPolicy = { allow: ['*.example.com'], deny: [], defaultAllow: false };

    expect(hostAllowed('docs.example.com', policy)).toBe(true);
    expect(hostAllowed('deep.docs.example.com', policy)).toBe(true);
    expect(hostAllowed('example.com', policy)).toBe(false);
  });

  it('allows exact matches', async () => {
    const { hostAllowed } = await import('../../src/tools/web.js');
    const policy: WebFetchPolicy = { allow: ['example.com'], deny: [], defaultAllow: false };

    expect(hostAllowed('example.com', policy)).toBe(true);
    expect(hostAllowed('docs.example.com', policy)).toBe(false);
  });

  it('gives denylist precedence over allowlist', async () => {
    const { hostAllowed } = await import('../../src/tools/web.js');
    const policy: WebFetchPolicy = {
      allow: ['*.example.com'],
      deny: ['blocked.example.com'],
      defaultAllow: false,
    };

    expect(hostAllowed('blocked.example.com', policy)).toBe(false);
  });

  it('uses defaultAllow when no allow or deny entries match', async () => {
    const { hostAllowed } = await import('../../src/tools/web.js');
    expect(hostAllowed('example.com', { allow: [], deny: [], defaultAllow: true })).toBe(true);
    expect(hostAllowed('example.com', { allow: [], deny: [], defaultAllow: false })).toBe(false);
  });
});

describe('webFetchTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('node:fs');
    vi.doUnmock('node:os');
  });

  it('fetches allowed hosts and returns JSON with trimmed text', async () => {
    mockPolicy({ allow: ['example.com'], deny: [], defaultAllow: false });
    const { webFetchTool } = await import('../../src/tools/web.js');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('  hello world  ', { headers: { 'content-type': 'text/plain' } }),
      ),
    );

    const result = JSON.parse(await webFetchTool({ url: 'https://example.com/page' }));

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/plain');
    expect(result.bytes).toBe(15);
    expect(result.text.trim()).toBe('hello world');
  });

  it('returns ok=false with the host when blocked by policy', async () => {
    mockPolicy({ allow: [], deny: [], defaultAllow: false });
    const { webFetchTool } = await import('../../src/tools/web.js');
    const result = JSON.parse(await webFetchTool({ url: 'https://blocked.example.com/page' }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked.example.com');
  });
});

function mockPolicy(policy: WebFetchPolicy): void {
  vi.resetModules();
  vi.doMock('node:os', () => ({
    default: { homedir: () => 'e:\\AI\\icli\\.test-home' },
  }));
  vi.doMock('node:fs', () => ({
    default: {
      existsSync: () => true,
      readFileSync: () => JSON.stringify(policy),
    },
  }));
}
