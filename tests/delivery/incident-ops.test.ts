import { describe, expect, it } from 'vitest';
import {
  IncidentManager,
  formatIncident,
  formatIncidentList,
} from '../../src/delivery/incident-ops.js';

describe('IncidentManager', () => {
  it('detects signals and manages incident workflow', () => {
    const manager = new IncidentManager();
    const detection = manager.detect('critical outage in release fabric');
    expect(detection.suggestedSeverity).toBe('critical');
    expect(detection.confidence).toBeGreaterThan(0.9);

    const incident = manager.create({
      title: 'Release fabric outage',
      severity: detection.suggestedSeverity,
      assignee: 'ops@icli',
    });
    expect(manager.getActive()).toHaveLength(1);

    const triaged = manager.triage(incident.id);
    expect(triaged?.status).toBe('triaging');

    const remediation = manager.suggestRemediation(incident.id);
    expect(remediation?.steps.length).toBeGreaterThan(0);

    const mitigating = remediation ? manager.applyRemediation(incident.id, remediation) : undefined;
    expect(mitigating?.status).toBe('mitigating');

    const resolved = manager.resolve(incident.id);
    expect(resolved?.status).toBe('resolved');
    expect(manager.getActive()).toHaveLength(0);
    expect(formatIncident(resolved!)).toContain('Release fabric outage');
  });

  it('returns recent history and formats incident lists', () => {
    const manager = new IncidentManager();
    manager.create({ title: 'Low priority alert', severity: 'low' });
    manager.create({ title: 'Latency spike', severity: 'high' });

    const history = manager.getHistory(1);
    expect(history).toHaveLength(1);
    expect(history[0]?.title).toBe('Latency spike');
    expect(formatIncidentList(manager.getHistory())).toContain('Latency spike');
  });
});
