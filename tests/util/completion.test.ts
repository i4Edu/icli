import { describe, expect, it } from 'vitest';
import { bashCompletion, defaultContext, pwshCompletion, zshCompletion } from '../../src/util/completion.js';

describe('completion generators', () => {
  const ctx = defaultContext();

  it.each([
    ['bash', bashCompletion],
    ['zsh', zshCompletion],
    ['pwsh', pwshCompletion],
  ])('%s completion includes commands and flags', (_name, generate) => {
    const script = generate(ctx);

    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain('icopilot');
    expect(script).toContain('icli');
    expect(script).toContain('/help');
    expect(script).toContain('/share');
    expect(script).toContain('/memory');
    expect(script).toContain('/task');
    expect(script).toContain('/tasks');
    expect(script).toContain('--prompt');
  });
});
