import { describe, expect, it } from 'vitest';
import { OutcomeLearner, type OutcomeRecord } from '../../src/adaptive/outcome-learning.js';

describe('OutcomeLearner', () => {
  it('learns a preferred strategy from matching contexts', () => {
    const learner = new OutcomeLearner();
    learner.record(makeRecord('1', 'retry', 'network timeout recovery', 'success', 0.9));
    learner.record(makeRecord('2', 'retry', 'network timeout recovery', 'success', 0.8));
    learner.record(makeRecord('3', 'backtrack', 'network timeout recovery', 'failure', 0.2));

    const preference = learner.getPreference('network timeout');

    expect(preference?.preferredStrategy).toBe('retry');
    expect(preference?.sampleSize).toBe(3);
    expect(learner.suggestStrategy('network timeout')).toBe('retry');
  });

  it('reports aggregate stats and supports export/import', () => {
    const learner = new OutcomeLearner();
    const records = [
      makeRecord('1', 'retry', 'network timeout', 'success', 0.9),
      makeRecord('2', 'alternative', 'compiler failure', 'partial', 0.6),
      makeRecord('3', 'backtrack', 'compiler failure', 'failure', 0.1),
    ];

    learner.importData(records);
    const stats = learner.getStats();
    const exported = learner.exportData();

    expect(stats.totalRecords).toBe(3);
    expect(stats.successRate).toBeGreaterThan(0.4);
    expect(stats.topStrategies[0]?.strategy).toBe('retry');
    expect(exported).toEqual(records);
  });

  it('prunes records older than the given cutoff', () => {
    const learner = new OutcomeLearner();
    learner.record(
      makeRecord('old', 'retry', 'network timeout', 'success', 0.9, '2024-01-01T00:00:00.000Z'),
    );
    learner.record(
      makeRecord(
        'new',
        'alternative',
        'network timeout',
        'success',
        0.8,
        '2026-01-01T00:00:00.000Z',
      ),
    );

    const removed = learner.prune('2025-01-01T00:00:00.000Z');

    expect(removed).toBe(1);
    expect(learner.exportData().map((record) => record.id)).toEqual(['new']);
  });
});

function makeRecord(
  id: string,
  strategy: string,
  context: string,
  result: OutcomeRecord['result'],
  score: number,
  timestamp = `2026-01-0${id}T00:00:00.000Z`,
): OutcomeRecord {
  return {
    id,
    strategy,
    context,
    result,
    score,
    timestamp,
  };
}
