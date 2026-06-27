import { describe, expect, it } from 'vitest';
import { buildMultiConfig, formatMultiResponses } from '../../src/commands/multi-cmd.js';

describe('buildMultiConfig', () => {
  it('parses comma-separated model names', () => {
    expect(buildMultiConfig(['gpt-4o,gpt-4o-mini'])).toEqual({
      models: ['gpt-4o', 'gpt-4o-mini'],
      maxTokens: 2048,
    });
  });

  it('enforces the max four model limit', () => {
    const result = buildMultiConfig(['a,b,c,d,e']);

    expect(result).toHaveProperty('error');
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining('at most 4 models'),
      }),
    );
  });

  it('returns an error when no args are provided', () => {
    const result = buildMultiConfig([]);

    expect(result).toHaveProperty('error');
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining('usage: /multi'),
      }),
    );
  });
});

describe('formatMultiResponses', () => {
  it('formats responses with model metadata', () => {
    const output = formatMultiResponses([
      { model: 'gpt-4o', content: 'First answer', tokens: 123, durationMs: 950 },
      { model: 'gpt-4o-mini', content: 'Second answer', tokens: 45, durationMs: 2400 },
    ]);

    expect(output).toContain('Multi-model comparison');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('First answer');
    expect(output).toContain('tokens: 123');
    expect(output).toContain('950ms');
    expect(output).toContain('gpt-4o-mini');
    expect(output).toContain('Second answer');
    expect(output).toContain('2.40s');
  });
});
