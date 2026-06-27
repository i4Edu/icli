import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  return import('../../src/agents/router.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('agent query router', () => {
  it.each([
    ['review', 'Please review this pull request for bugs'],
    ['explain', 'Why does this cache invalidation happen twice?'],
    ['fix', 'Fix the bug causing login errors in production'],
    ['refactor', 'Refactor this parser to improve readability'],
    ['test', 'Add a test spec for the checkout flow'],
    ['explore', 'Where is the session manager defined?'],
    ['plan', 'Design the architecture plan for a plugin system'],
  ])('routes %s queries', async (agent, query) => {
    const { routeQuery } = await loadRouter();

    const match = routeQuery(query);

    expect(match).toEqual({
      agent,
      confidence: expect.any(Number),
    });
    expect(match?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('returns null when no route clears the threshold', async () => {
    const { routeQuery } = await loadRouter();

    expect(routeQuery('Hello there')).toBeNull();
  });

  it('supports overriding the threshold', async () => {
    const { routeQuery, setRouteThreshold } = await loadRouter();
    setRouteThreshold(0.95);

    expect(routeQuery('Review this diff')).toBeNull();
  });

  it('supports custom routes', async () => {
    const { addRoute, routeQuery } = await loadRouter();
    addRoute({
      pattern: /\bship it\b/g,
      agentType: 'deploy',
      confidence: 0.6,
    });

    expect(routeQuery('Ship it to staging')).toEqual({
      agent: 'deploy',
      confidence: 0.72,
    });
  });

  it('reads the default threshold from the environment', async () => {
    vi.stubEnv('ICOPILOT_AGENT_ROUTE_THRESHOLD', '0.9');
    const { routeQuery, getRouteThreshold } = await loadRouter();

    expect(getRouteThreshold()).toBe(0.9);
    expect(routeQuery('Review this diff')).toBeNull();
  });
});
