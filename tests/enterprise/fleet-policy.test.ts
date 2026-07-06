import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FleetPolicyManager,
  formatPolicyRollout,
  loadFleetPolicies,
} from '../../src/enterprise/fleet-policy.js';

describe('FleetPolicyManager', () => {
  let testRoot = '';
  let cwd = '';

  beforeEach(() => {
    testRoot = path.join(
      process.cwd(),
      '.test-artifacts',
      'enterprise',
      'fleet-policy',
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    cwd = path.join(testRoot, 'repo');
    fs.mkdirSync(path.join(cwd, '.icopilot', 'enterprise'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('loads policies from yaml', () => {
    fs.writeFileSync(
      path.join(cwd, '.icopilot', 'enterprise', 'fleet-policies.yaml'),
      [
        'policies:',
        '  - id: baseline',
        '    name: Baseline',
        '    version: 1.0.0',
        '    rolloutStrategy: all',
        '    targets: [repo-a]',
        '    rules:',
        '      - id: deny-shell',
        '        type: command',
        '        condition: command == \"rm -rf /\"',
        '        action: deny',
        '        severity: critical',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(loadFleetPolicies(cwd)[0]).toEqual({
      id: 'baseline',
      name: 'Baseline',
      version: '1.0.0',
      rolloutStrategy: 'all',
      targets: ['repo-a'],
      rules: [
        {
          id: 'deny-shell',
          type: 'command',
          condition: 'command == "rm -rf /"',
          action: 'deny',
          severity: 'critical',
        },
      ],
    });
  });

  it('validates, deploys, and rolls back policies', () => {
    let now = new Date('2026-02-01T00:00:00.000Z');
    const manager = new FleetPolicyManager({
      now: () => now,
    });

    const policy = manager.createPolicy({
      id: 'baseline',
      name: 'Baseline',
      version: '1.0.0',
      rolloutStrategy: 'canary',
      targets: ['repo-a', 'repo-b'],
      rules: [
        {
          id: 'deny-shell',
          type: 'command',
          condition: 'dangerous == true',
          action: 'deny',
          severity: 'critical',
        },
      ],
    });

    expect(manager.validatePolicy(policy)).toEqual({ valid: true, errors: [] });
    expect(manager.listPolicies()).toHaveLength(1);

    const rollout = manager.deployPolicy('baseline');
    expect(rollout.status).toBe('rolling');
    expect(rollout.progress).toBe(50);
    expect(formatPolicyRollout(rollout)).toContain('baseline');

    now = new Date('2026-02-01T01:00:00.000Z');
    const rollback = manager.rollback('baseline');
    expect(rollback.status).toBe('failed');
    expect(rollback.progress).toBe(0);
    expect(manager.getStatus('baseline')).toEqual(rollback);
  });

  it('reports validation failures', () => {
    const manager = new FleetPolicyManager();
    expect(
      manager.validatePolicy({
        id: '',
        name: '',
        version: '',
        rolloutStrategy: 'all',
        targets: [],
        rules: [],
      }),
    ).toEqual({
      valid: false,
      errors: [
        'policy id is required',
        'policy name is required',
        'policy version is required',
        'policy must include at least one rule',
        'policy must include at least one target',
      ],
    });
  });
});
