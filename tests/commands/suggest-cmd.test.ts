import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';
import { suggestCommand } from '../../src/commands/suggest-cmd.js';

vi.mock('../../src/api/github-models.js', () => ({
  streamChat: vi.fn(async (opts: { onToken: (token: string) => void }) => {
    opts.onToken('Get-ChildItem -Recurse');
    return {
      content: 'Get-ChildItem -Recurse',
      toolCalls: [],
      finishReason: 'stop',
    };
  }),
}));

describe('suggestCommand', () => {
  it('returns a non-empty formatted string', async () => {
    const session = {
      state: {
        model: 'gpt-4o',
        cwd: 'E:\\AI\\icli',
      },
    } as unknown as Session;

    const output = await suggestCommand('find files', session, new AbortController().signal);

    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toContain('Get-ChildItem -Recurse');
  });
});
