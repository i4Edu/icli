import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/session/session.js';
import { historyCommand } from '../../src/commands/history-cmd.js';

function createSession(
  messages: Array<{ role: string; content: unknown }>,
  totalTokens = 123,
): Session {
  return {
    state: { messages },
    tokenUsage: () => totalTokens,
  } as unknown as Session;
}

describe('historyCommand', () => {
  it('lists session messages by default', () => {
    const session = createSession([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello from the user message.' },
      {
        role: 'assistant',
        content:
          'This assistant reply is intentionally long so the preview output gets truncated at eighty characters exactly.',
      },
    ]);

    const output = historyCommand([], session);

    expect(output).toContain('History');
    expect(output).toContain('0');
    expect(output).toContain('system');
    expect(output).toContain('Hello from the user message.');
    expect(output).toContain('…');
  });

  it('filters messages with case-insensitive search', () => {
    const session = createSession([
      { role: 'user', content: 'Alpha note' },
      { role: 'assistant', content: 'Contains Beta keyword' },
      { role: 'user', content: 'gamma' },
    ]);

    const output = historyCommand(['search', 'beta'], session);

    expect(output).toContain('Contains Beta keyword');
    expect(output).not.toContain('Alpha note');
    expect(output).not.toContain('gamma');
  });

  it('shows full content for a valid index and warns for an invalid index', () => {
    const session = createSession([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'full assistant response' },
    ]);

    const shown = historyCommand(['show', '1'], session);
    const missing = historyCommand(['show', '9'], session);

    expect(shown).toContain('Message 1');
    expect(shown).toContain('full assistant response');
    expect(missing).toContain('Message not found: 9');
  });

  it('returns the total message count and token usage', () => {
    const session = createSession(
      [
        { role: 'system', content: 'one' },
        { role: 'user', content: 'two' },
        { role: 'assistant', content: 'three' },
      ],
      42,
    );

    const output = historyCommand(['count'], session);

    expect(output).toContain('History count');
    expect(output).toContain('messages: 3');
    expect(output).toContain('tokens:   42');
  });
});
