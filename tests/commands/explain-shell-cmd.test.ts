import { describe, expect, it } from 'vitest';
import { explainShellCommand } from '../../src/commands/explain-shell-cmd.js';

describe('explainShellCommand', () => {
  it('returns a payload with command and prompt fields', () => {
    const payload = explainShellCommand('git rebase -i HEAD~5');

    expect(payload).toEqual({
      command: 'git rebase -i HEAD~5',
      prompt: expect.any(String),
    });
    expect(payload.prompt.length).toBeGreaterThan(0);
  });

  it('includes the command text in the prompt', () => {
    const command = 'gh copilot explain';
    const payload = explainShellCommand(command);

    expect(payload.prompt).toContain(command);
  });

  it('handles an empty command string', () => {
    const payload = explainShellCommand('');

    expect(payload.command).toBe('');
    expect(payload.prompt).toContain('(empty command)');
    expect(payload.prompt).toContain('Raw command text: ""');
  });

  it('handles commands with special characters', () => {
    const command = 'find . -name "*.ts" | xargs grep "TODO && FIXME"';
    const payload = explainShellCommand(command);

    expect(payload.command).toBe(command);
    expect(payload.prompt).toContain(command);
  });
});
