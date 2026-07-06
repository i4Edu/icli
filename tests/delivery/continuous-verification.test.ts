import { describe, expect, it } from 'vitest';
import {
  ContinuousVerifier,
  formatVerificationResults,
} from '../../src/delivery/continuous-verification.js';

describe('ContinuousVerifier', () => {
  it('adds checks and runs them successfully', () => {
    const verifier = new ContinuousVerifier();
    verifier.addCheck({
      id: 'typecheck',
      name: 'Typecheck',
      type: 'typecheck',
      schedule: 'pre-commit',
      command: 'npm run typecheck',
    });

    const runs = verifier.runAll();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.passed).toBe(true);
    expect(verifier.isHealthy()).toBe(true);
    expect(formatVerificationResults(runs)).toContain('typecheck');
  });

  it('applies auto-fix for fixable failing checks', () => {
    const verifier = new ContinuousVerifier({ autoFix: true, maxFixAttempts: 1 });
    verifier.addCheck({
      id: 'lint',
      name: 'Lint autofix fail',
      type: 'lint',
      schedule: 'on-change',
      command: 'npm run lint -- --fix fail',
    });

    const run = verifier.runCheck('lint');
    expect(run.passed).toBe(true);
    expect(run.fixApplied).toBe(true);
    expect(verifier.isHealthy()).toBe(true);
  });

  it('reports unhealthy state when failures remain', () => {
    const verifier = new ContinuousVerifier({ autoFix: true, maxFixAttempts: 1 });
    verifier.addCheck({
      id: 'security',
      name: 'Security fail unfixable',
      type: 'security',
      schedule: 'periodic',
      command: 'scan fail unfixable',
    });

    const run = verifier.runCheck('security');
    expect(run.passed).toBe(false);
    expect(verifier.isHealthy()).toBe(false);
  });

  it('filters results and removes checks', () => {
    const verifier = new ContinuousVerifier();
    verifier.addCheck({
      id: 'test',
      name: 'Unit tests',
      type: 'test',
      schedule: 'on-change',
      command: 'npm test',
    });

    const since = new Date(Date.now() - 1_000).toISOString();
    verifier.runCheck('test');
    expect(verifier.getResults(since)).toHaveLength(1);
    expect(verifier.removeCheck('test')).toBe(true);
    expect(verifier.getConfig().checks).toHaveLength(0);
  });
});
