import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/session/session.js';
import { costCommand } from '../../src/commands/cost-cmd.js';

describe('costCommand', () => {
  it('summarizes token usage and estimated cost', () => {
    const session = {
      state: {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'hello world' },
          { role: 'assistant', content: 'hi there' },
        ],
      },
    } as unknown as Session;

    const output = costCommand(session);

    expect(output).toContain('gpt-4o');
    expect(output).toContain('$');
  });
});
