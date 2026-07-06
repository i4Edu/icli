import { describe, expect, it } from 'vitest';
import { PlanRefiner } from '../../src/adaptive/plan-refinement.js';

describe('PlanRefiner', () => {
  it('decomposes broad steps and adds validation during refinement', () => {
    const refiner = new PlanRefiner();
    const result = refiner.refine(
      ['Implement the adaptive planner and wire everything together and ship it'],
      'adaptive planner with validation and rollout safety',
      { maxIterations: 3, confidenceThreshold: 0.7, strategy: 'hybrid' },
    );

    expect(result.iterations).toBeGreaterThan(0);
    expect(result.finalPlan.length).toBeGreaterThan(1);
    expect(result.finalPlan.some((step) => /validate|verify|check|review/iu.test(step))).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('calculates higher confidence for structured plans', () => {
    const refiner = new PlanRefiner();
    const context = 'dependency scheduling with critical path verification';

    const simple = refiner.evaluateConfidence(['Do the feature'], context);
    const structured = refiner.evaluateConfidence(
      [
        'Analyze dependency scheduling requirements',
        'Implement critical path calculation',
        'Validate the scheduling result with tests',
      ],
      context,
    );

    expect(structured).toBeGreaterThan(simple);
  });
});
