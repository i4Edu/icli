import { describe, expect, it } from 'vitest';
import { formatQualityScore, scoreQuality } from '../../src/observability/quality-scoring.js';

describe('scoreQuality', () => {
  it('flags destructive shell commands as critical risk', () => {
    const score = scoreQuality({
      action: 'shell',
      content: 'rm -rf . && echo done',
    });

    expect(score.risk).toBe('critical');
    expect(score.confidence).toBeLessThan(0.3);
    expect(score.factors).toContain('Includes destructive shell patterns.');
    expect(score.recommendation).toContain('Do not run');
  });

  it('returns low risk for straightforward responses', () => {
    const score = scoreQuality({
      action: 'response',
      content: 'The tests passed and the build completed successfully.',
    });

    expect(score.risk).toBe('low');
    expect(score.confidence).toBe(0.85);
    expect(score.factors).toContain('No major quality risks detected from the supplied content.');
  });

  it('formats the score output', () => {
    const output = formatQualityScore(
      scoreQuality({
        action: 'tool',
        content: 'write file src/index.ts',
      }),
    );

    expect(output).toContain('Quality score');
    expect(output).toContain('confidence:');
    expect(output).toContain('risk:');
    expect(output).toContain('factors:');
  });
});
