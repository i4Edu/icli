import { describe, expect, it } from 'vitest';
import { ConsensusEngine } from '../../src/adaptive/consensus.js';

describe('ConsensusEngine', () => {
  it('selects the majority answer and reports agreement', () => {
    const engine = new ConsensusEngine();
    const result = engine.evaluate({
      question: 'Which scheduler should run?',
      responses: [
        { source: 'agent-a', answer: 'Use the dependency scheduler', confidence: 0.7 },
        { source: 'agent-b', answer: 'Use the dependency scheduler', confidence: 0.8 },
        { source: 'agent-c', answer: 'Use a simple queue', confidence: 0.6 },
      ],
    });

    expect(result.decision).toBe('Use the dependency scheduler');
    expect(result.agreement).toBeCloseTo(2 / 3, 3);
    expect(result.dissenting).toEqual(['agent-c']);
  });

  it('uses weighted consensus when a higher-confidence minority wins', () => {
    const engine = new ConsensusEngine();
    const result = engine.evaluate(
      {
        question: 'What is the safest fix?',
        responses: [
          { source: 'agent-a', answer: 'Retry the request', confidence: 0.3 },
          { source: 'agent-b', answer: 'Retry the request', confidence: 0.4 },
          { source: 'agent-c', answer: 'Backtrack and inspect logs', confidence: 0.95 },
        ],
      },
      { strategy: 'weighted', minAgreement: 0.3, tieBreaker: 'highest-confidence' },
    );

    expect(result.decision).toBe('Backtrack and inspect logs');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('abstains when unanimous consensus is required but not achieved', () => {
    const engine = new ConsensusEngine();
    const decision = engine.getDecision(
      {
        question: 'Ship now?',
        responses: [
          { source: 'agent-a', answer: 'yes', confidence: 0.8 },
          { source: 'agent-b', answer: 'no', confidence: 0.8 },
        ],
      },
      { strategy: 'unanimous', minAgreement: 1, tieBreaker: 'abstain' },
    );

    expect(decision).toBe('abstain');
  });
});
