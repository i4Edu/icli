import { describe, expect, it } from 'vitest';
import {
  formatAttributionReport,
  TokenAttributionTracker,
} from '../../src/observability/token-attribution.js';

describe('TokenAttributionTracker', () => {
  it('aggregates usage by source', () => {
    const tracker = new TokenAttributionTracker();
    tracker.record('/trace', 100, 0.01);
    tracker.record('/batch', 300, 0.03);
    tracker.record('/trace', 50, 0.005);

    const report = tracker.getReport();

    expect(report.totalTokens).toBe(450);
    expect(report.totalCost).toBeCloseTo(0.045);
    expect(report.attributions[0]).toMatchObject({
      source: '/batch',
      tokens: 300,
    });
    expect(report.attributions[1]).toMatchObject({
      source: '/trace',
      tokens: 150,
    });
    expect(report.attributions[0]?.percentage).toBeCloseTo(66.666, 1);
    expect(report.topDrivers).toEqual(['/batch', '/trace']);
  });

  it('resets all tracked usage', () => {
    const tracker = new TokenAttributionTracker();
    tracker.record('/trace', 100, 0.01);
    tracker.reset();

    expect(tracker.getReport()).toEqual({
      attributions: [],
      totalTokens: 0,
      totalCost: 0,
      topDrivers: [],
    });
  });

  it('formats the attribution report', () => {
    const tracker = new TokenAttributionTracker();
    tracker.record('/batch', 120, 0.012);

    const output = formatAttributionReport(tracker.getReport());

    expect(output).toContain('Token attribution');
    expect(output).toContain('/batch');
    expect(output).toContain('120');
    expect(output).toContain('top drivers');
  });
});
