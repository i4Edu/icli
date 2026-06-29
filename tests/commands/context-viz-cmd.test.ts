import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';

const memoryState = vi.hoisted(() => ({ text: '' }));
const pinnedState = vi.hoisted(() => ({ text: '' }));

vi.mock('../../src/context/memory.js', () => ({
  loadMemoryBlock: vi.fn(() => memoryState.text),
}));

vi.mock('../../src/context/pinned.js', () => ({
  PinnedContext: {
    fromJSON: vi.fn(() => ({
      render: () => pinnedState.text,
    })),
  },
}));

import { showContextUsage } from '../../src/commands/context-viz-cmd.js';

function createSession(): Session {
  const fileBlock = [
    '### Referenced files',
    '',
    '#### src/app.ts',
    '```ts',
    `export const payload = '${'x'.repeat(400)}';`,
    '```',
  ].join('\n');

  return {
    state: {
      mode: 'ask',
      cwd: 'E:\\AI\\icli',
      pinned: [],
      gitContext: [],
      messages: [
        { role: 'user', content: `Please review the file.\n\n${fileBlock}` },
        { role: 'assistant', content: 'Here is the summary.' },
        { role: 'tool', tool_call_id: 'call_1', content: 'tool output' },
      ],
    },
  } as unknown as Session;
}

describe('showContextUsage', () => {
  it('renders a visual context usage summary', () => {
    memoryState.text = 'Remember to preserve slash commands.';
    pinnedState.text =
      '### Pinned context files\n\n#### src/pinned.ts\n```ts\nexport const pinned = true;\n```';

    const output = showContextUsage(createSession());

    expect(output).toContain('Context usage');
    expect(output).toMatch(/\[[█░]+\] \d+% \([^)]+ tokens\)/);
    expect(output).toContain('System:');
    expect(output).toContain('History:');
    expect(output).toContain('Files:');
    expect(output).toContain('Free:');
    expect(output).toContain('Breakdown');
    expect(output).toContain('remaining context budget');
  });
});
