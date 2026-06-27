import { describe, expect, it } from 'vitest';
import { aggregateResults, type AgentResult } from '../../src/agents/aggregator.js';

describe('aggregateResults', () => {
  it('returns an empty-state markdown summary when there are no results', () => {
    const aggregated = aggregateResults([]);

    expect(aggregated.summary).toBe('## Summary\n- No agent results available.');
    expect(aggregated.details).toEqual([]);
    expect(aggregated.conflicts).toEqual([]);
    expect(aggregated.sources).toEqual([]);
  });

  it('deduplicates overlapping suggestions and keeps source details in markdown', () => {
    const results: AgentResult[] = [
      {
        name: 'planner',
        output: '- Add regression tests for the auth flow.\n- Use feature flags for rollout.',
        confidence: 0.92,
        tokens: 120,
      },
      {
        name: 'reviewer',
        output: 'Add regression tests for the auth flow. Document the migration path.',
        confidence: 0.7,
        tokens: 80,
      },
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.sources).toEqual(['planner', 'reviewer']);
    expect(aggregated.summary).toContain('## Summary');
    expect(aggregated.summary).toContain('Add regression tests for the auth flow. _(sources: planner, reviewer)_');
    expect(aggregated.summary.match(/Add regression tests for the auth flow\./g)).toHaveLength(1);
    expect(aggregated.summary).toContain('Use feature flags for rollout.');
    expect(aggregated.summary).toContain('Document the migration path.');

    expect(aggregated.details).toEqual([
      '### planner\nconfidence: 92% • tokens: 120\n- Add regression tests for the auth flow.\n- Use feature flags for rollout.',
      '### reviewer\nconfidence: 70% • tokens: 80\n- Add regression tests for the auth flow.\n- Document the migration path.',
    ]);
  });

  it('detects contradictory advice across agents', () => {
    const results: AgentResult[] = [
      {
        name: 'agent-a',
        output: 'Use feature flags for rollout.',
      },
      {
        name: 'agent-b',
        output: 'Avoid feature flags for rollout.',
      },
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.conflicts).toEqual([
      '- Conflict between **agent-a** and **agent-b** on _feature flags for rollout_: "Use feature flags for rollout." vs "Avoid feature flags for rollout."',
    ]);
  });

  it('extracts actionable points from paragraphs into markdown bullet summaries', () => {
    const aggregated = aggregateResults([
      {
        name: 'synthesizer',
        output:
          'Review the API boundary before refactoring. Then add contract tests for the webhook handler! Finally, monitor error rates after release.',
      },
    ]);

    expect(aggregated.summary).toContain('- Review the API boundary before refactoring.');
    expect(aggregated.summary).toContain('- Then add contract tests for the webhook handler!');
    expect(aggregated.summary).toContain('- Finally, monitor error rates after release.');
    expect(aggregated.details).toEqual([
      '### synthesizer\n- Review the API boundary before refactoring.\n- Then add contract tests for the webhook handler!\n- Finally, monitor error rates after release.',
    ]);
  });
});
