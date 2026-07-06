import { describe, expect, it } from 'vitest';
import {
  SelfRecoveryEngine,
  type RecoveryContext,
  type RecoveryStrategy,
} from '../../src/adaptive/self-recovery.js';

describe('SelfRecoveryEngine', () => {
  it('prefers retry for transient failures', () => {
    const engine = new SelfRecoveryEngine();
    const retry: RecoveryStrategy = {
      id: 'retry-network',
      name: 'Retry network step',
      type: 'retry',
      conditions: ['timeout', 'network'],
      maxAttempts: 2,
    };
    engine.addStrategy(retry);

    const context: RecoveryContext = {
      error: 'Network timeout while calling provider',
      failedStep: 'Fetch model response',
      history: ['Prepare prompt', 'Fetch model response'],
      availableStrategies: [retry],
    };

    const result = engine.recover(context);

    expect(result.strategy.id).toBe('retry-network');
    expect(result.success).toBe(true);
    expect(result.output).toContain('succeeded');
  });

  it('builds an alternative path for non-transient failures', () => {
    const engine = new SelfRecoveryEngine();
    const alternative: RecoveryStrategy = {
      id: 'alt-build',
      name: 'Alternative build path',
      type: 'alternative',
      conditions: ['build', 'implement'],
      maxAttempts: 1,
    };

    const result = engine.recover({
      error: 'Compilation failed because import resolution is incorrect',
      failedStep: 'Implement and validate module integration',
      history: ['Inspect compile errors'],
      availableStrategies: [alternative],
    });

    expect(result.strategy.id).toBe('alt-build');
    expect(result.success).toBe(true);
    expect(result.alternativePath).toBeDefined();
    expect(result.alternativePath!.length).toBeGreaterThan(1);
  });

  it('tracks configured strategies and recorded outcomes', () => {
    const engine = new SelfRecoveryEngine();
    const strategy: RecoveryStrategy = {
      id: 'backtrack-on-failure',
      name: 'Backtrack one step',
      type: 'backtrack',
      conditions: ['failure'],
      maxAttempts: 1,
    };

    engine.addStrategy(strategy);
    engine.recordOutcome(strategy.id, true);

    expect(engine.getStrategies()).toEqual([strategy]);
    expect(engine.backtrack(['one', 'two', 'three'])).toEqual(['one', 'two']);
  });
});
