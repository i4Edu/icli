import { describe, expect, it } from 'vitest';
import {
  SLOAutomation,
  formatSLOStatus,
} from '../../src/enterprise/slo-automation.js';

describe('SLOAutomation', () => {
  it('tracks statuses and breached SLOs', () => {
    const metrics = new Map<string, number>([
      ['availability:1d', 99.95],
      ['latency:1h', 97.1],
    ]);

    const automation = new SLOAutomation({
      metricProvider: (metric, window) => metrics.get(`${metric}:${window}`) ?? 100,
      slos: [
        {
          id: 'availability',
          name: 'API Availability',
          metric: 'availability',
          target: 99.9,
          window: '1d',
          runbook: 'recover-api',
        },
        {
          id: 'latency',
          name: 'P95 Latency',
          metric: 'latency',
          target: 98.5,
          window: '1h',
          runbook: 'rollback-cache',
        },
      ],
    });

    const statuses = automation.checkStatus();
    expect(statuses).toHaveLength(2);
    expect(statuses.find((status) => status.slo.id === 'availability')?.breached).toBe(false);
    expect(statuses.find((status) => status.slo.id === 'latency')?.breached).toBe(true);
    expect(automation.getBreached().map((status) => status.slo.id)).toEqual(['latency']);
    expect(formatSLOStatus(statuses)).toContain('API Availability');
  });

  it('executes runbooks and honors onFail handling', () => {
    const automation = new SLOAutomation({
      runbooks: [
        {
          id: 'recover-api',
          name: 'Recover API',
          triggers: ['availability'],
          steps: [
            {
              id: 'step-1',
              action: 'page',
              params: { team: 'oncall' },
              onFail: 'continue',
            },
            {
              id: 'step-2',
              action: 'rollback',
              params: { service: 'api' },
              onFail: 'escalate',
            },
          ],
        },
      ],
      stepExecutor: (step) => (step.id === 'step-1' ? 'page delivery failed' : true),
    });

    const execution = automation.executeRunbook('recover-api', { incident: 'INC-42' });
    expect(execution.status).toBe('complete');
    expect(execution.steps[0]).toEqual({
      stepId: 'step-1',
      action: 'page',
      success: false,
      message: 'page delivery failed',
    });
    expect(execution.steps[1]?.success).toBe(true);
  });
});
