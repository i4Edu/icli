import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';
import { config } from '../../src/config.js';
import { ASK_SYSTEM } from '../../src/commands/prompts.js';
import { countTokensSync } from '../../src/util/tokens.js';

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

import {
  buildContextBreakdown,
  contextCommand,
  renderContextBreakdown,
} from '../../src/commands/context-cmd.js';

function createSession(): Session {
  const fileBlock = [
    '### Referenced files',
    '',
    '#### src/app.ts',
    '```ts',
    `export const payload = '${'x'.repeat(320)}';`,
    '```',
  ].join('\n');

  return {
    state: {
      mode: 'ask',
      cwd: 'E:\\AI\\icli',
      pinned: [],
      messages: [
        { role: 'user', content: `Explain the module\n\n${fileBlock}` },
        {
          role: 'assistant',
          content: 'I will inspect and summarize it.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'export const payload = 1;' },
        { role: 'system', content: 'Persisted summary kept in history.' },
      ],
    },
  } as unknown as Session;
}

describe('buildContextBreakdown', () => {
  it('separates system, files, memory, pinned, history, and tool results', () => {
    memoryState.text = '## Project memory\nRemember the deployment checklist.';
    pinnedState.text = '### Pinned context files\n\n#### src/pinned.ts\n```ts\nexport const pinned = true;\n```';
    const session = createSession();
    const fileBlock = String((session.state.messages[0] as { content: string }).content).split('\n\n').slice(1).join('\n\n');
    const breakdown = buildContextBreakdown(session);

    const map = new Map(breakdown.sources.map((entry) => [entry.name, entry]));
    const expectedHistory =
      countTokensSync('Explain the module') +
      countTokensSync('I will inspect and summarize it.') +
      countTokensSync('Persisted summary kept in history.');
    const expectedTools =
      countTokensSync(
        JSON.stringify([
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
          },
        ]),
      ) +
      countTokensSync('export const payload = 1;') +
      countTokensSync('call_1');

    expect(map.get('System prompt')?.tokens).toBe(countTokensSync(ASK_SYSTEM));
    expect(map.get('Memory')?.tokens).toBe(countTokensSync(memoryState.text));
    expect(map.get('Pinned files')?.tokens).toBe(countTokensSync(pinnedState.text));
    expect(map.get('File references')?.tokens).toBe(countTokensSync(fileBlock));
    expect(map.get('Conversation history')?.tokens).toBe(expectedHistory);
    expect(map.get('Tool results')?.tokens).toBe(expectedTools);
    expect(breakdown.total).toBe(breakdown.sources.reduce((sum, entry) => sum + entry.tokens, 0));
    expect(breakdown.remaining).toBe(config.contextWindow - breakdown.total);
    expect(breakdown.sources.find((entry) => entry.name === 'File references')?.percentage).toBeGreaterThan(0);
  });
});

describe('renderContextBreakdown', () => {
  it('renders a human-friendly breakdown with bars', () => {
    memoryState.text = 'remember this';
    pinnedState.text = '';
    const output = renderContextBreakdown(buildContextBreakdown(createSession()));

    expect(output).toContain('Context hub');
    expect(output).toContain('Sources');
    expect(output).toContain('System prompt');
    expect(output).toContain('Conversation history');
    expect(output).toContain('[');
    expect(output).toContain('remaining:');
  });
});

describe('contextCommand', () => {
  it('shows sources, budget, and trim subcommands', () => {
    memoryState.text = 'short memory';
    pinnedState.text = '### Pinned context files\n\n#### src/a.ts\n```ts\nconst a = 1;\n```';
    const session = createSession();

    const defaultOutput = contextCommand([], session);
    const sourcesOutput = contextCommand(['sources'], session);
    const budgetOutput = contextCommand(['budget'], session);
    const trimOutput = contextCommand(['trim'], session);

    expect(defaultOutput).toContain('Context hub');
    expect(sourcesOutput).toContain('Context sources');
    expect(sourcesOutput).toContain('(file)');
    expect(budgetOutput).toContain('Context budget');
    expect(budgetOutput).toContain('remaining:');
    expect(trimOutput).toContain('Trim suggestions');
    expect(trimOutput).toContain('1. File references');
    expect(trimOutput).toContain('remove large @file injections');
  });

  it('shows usage for unknown subcommands', () => {
    memoryState.text = '';
    pinnedState.text = '';

    const output = contextCommand(['wat'], createSession());

    expect(output).toContain('unknown /context subcommand: wat');
    expect(output).toContain('usage: /context [sources|budget|trim]');
  });
});
