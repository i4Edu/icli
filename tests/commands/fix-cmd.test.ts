import { describe, expect, it } from 'vitest';
import { buildFixPrompt } from '../../src/commands/fix-cmd.js';

describe('buildFixPrompt', () => {
  it('returns a valid payload for a non-empty error', () => {
    const payload = buildFixPrompt('git error: failed to push');

    expect(payload).toEqual({
      error: 'git error: failed to push',
      prompt: expect.any(String),
    });
    expect(payload.prompt).toContain('Identify the error');
    expect(payload.prompt).toContain('root cause');
    expect(payload.prompt).toContain('2-3 fixes ranked by likelihood');
    expect(payload.prompt).toContain('exact commands to run');
  });

  it('includes the original error text in the prompt', () => {
    const errorText = 'fatal: unable to access repository';
    const payload = buildFixPrompt(errorText);

    expect(payload.prompt).toContain(errorText);
  });

  it('handles an empty error string', () => {
    const payload = buildFixPrompt('');

    expect(payload.error).toBe('');
    expect(payload.prompt).toContain('[no error text provided]');
    expect(payload.prompt).toContain('suggest 2-3 fixes ranked by likelihood');
  });
});
