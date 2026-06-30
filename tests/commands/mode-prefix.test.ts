import { describe, expect, it } from 'vitest';
import { parseModePrefix, resolveModePrefix } from '../../src/commands/mode-prefix.js';

describe('parseModePrefix', () => {
  it('returns null for normal input', () => {
    expect(parseModePrefix('explain this function')).toEqual({
      mode: null,
      message: 'explain this function',
    });
  });

  it('parses ask/code/architect prefixes', () => {
    expect(parseModePrefix('/ask why is this slow?')).toEqual({
      mode: 'ask',
      message: 'why is this slow?',
    });
    expect(parseModePrefix('/code implement the cache')).toEqual({
      mode: 'code',
      message: 'implement the cache',
    });
    expect(parseModePrefix('/architect redesign auth')).toEqual({
      mode: 'architect',
      message: 'redesign auth',
    });
    expect(parseModePrefix('/reason diagnose network speed')).toEqual({
      mode: 'reason',
      message: 'diagnose network speed',
    });
  });
});

describe('resolveModePrefix', () => {
  it('builds a slash-style forwarding result for prefixed messages', () => {
    const result = resolveModePrefix('/architect redesign the auth module');
    expect(result).toEqual({
      matched: true,
      consumed: false,
      forwardInput: 'redesign the auth module',
      turnMode: 'architect',
    });
  });

  it('returns a usage hint when the prefix has no message', () => {
    expect(resolveModePrefix('/ask')).toEqual({
      matched: true,
      consumed: true,
      usage: 'usage: /ask <message>',
    });
  });
});
