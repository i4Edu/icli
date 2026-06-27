import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';
import { config } from '../../src/config.js';
import { countTokensSync } from '../../src/util/tokens.js';
import { PLAN_SYSTEM } from '../../src/commands/prompts.js';

const memoryState = vi.hoisted(() => ({ text: '' }));

vi.mock('../../src/context/memory.js', () => ({
  loadMemoryBlock: vi.fn(() => memoryState.text),
}));

import { renderTokenBar, tokensCommand } from '../../src/commands/tokens-cmd.js';

describe('renderTokenBar', () => {
  it('renders 0%', () => {
    expect(renderTokenBar(0, 100, 10)).toBe('[░░░░░░░░░░] 0%');
  });

  it('renders 50%', () => {
    expect(renderTokenBar(50, 100, 10)).toBe('[█████░░░░░] 50%');
  });

  it('renders 100%', () => {
    expect(renderTokenBar(100, 100, 10)).toBe('[██████████] 100%');
  });
});

describe('tokensCommand', () => {
  it('summarizes tokens across system, messages, file refs, tools, and memory', () => {
    const fileBlock = [
      '### Referenced files',
      '',
      '#### src/app.ts',
      '```ts',
      `export const big = '${'x'.repeat(400)}';`,
      '```',
    ].join('\n');
    const memoryBlock = '## Project memory\nRemember the deployment checklist.';
    memoryState.text = memoryBlock;

    const session = {
      state: {
        mode: 'ask',
        cwd: 'E:\\AI\\icli',
        messages: [
          { role: 'user', content: `Explain this file\n\n${fileBlock}` },
          {
            role: 'assistant',
            content: 'I will inspect the file and summarize it.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'export const big = "value";' },
          { role: 'assistant', content: 'Done. The module exports a large constant.' },
        ],
      },
    } as unknown as Session;

    const output = tokensCommand(session);

    expect(output).toContain('Token analysis');
    expect(output).toContain('By category');
    expect(output).toContain('By message');
    expect(output).toContain('System prompt');
    expect(output).toContain('User messages');
    expect(output).toContain('Assistant responses');
    expect(output).toContain('Tool calls');
    expect(output).toContain('File references');
    expect(output).toContain('Memory block');
    expect(output).toContain('#0 user');
    expect(output).toContain('#1 assistant');
    expect(output).toContain('#2 tool');
    expect(output).toContain('#3 assistant');
    expect(output).toContain('largest:');
    expect(output).toContain('File references');
    expect(output).toContain(String(countTokensSync(fileBlock)));
    expect(output).toContain(String(countTokensSync(memoryBlock)));
  });

  it('handles an empty session', () => {
    memoryState.text = '';
    const session = {
      state: {
        mode: 'plan',
        cwd: 'E:\\AI\\icli',
        messages: [],
      },
    } as unknown as Session;

    const output = tokensCommand(session);
    const expectedRemaining = config.contextWindow - countTokensSync(PLAN_SYSTEM);

    expect(output).toContain('Token analysis');
    expect(output).toContain('No persisted messages.');
    expect(output).toContain('Memory block');
    expect(output).toContain('none loaded');
    expect(output).toContain(String(expectedRemaining));
  });
});
