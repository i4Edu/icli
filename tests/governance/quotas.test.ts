import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotaManager, formatQuotaStatus } from '../../src/governance/quotas.js';

describe('quotas', () => {
  let tmpRoot: string;
  let workspace: string;
  let quotaPath: string;
  let now: Date;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-governance-quotas');
    fs.mkdirSync(tmpRoot, { recursive: true });
    workspace = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    quotaPath = path.join(workspace, '.icopilot', 'quotas.yaml');
    fs.mkdirSync(path.dirname(quotaPath), { recursive: true });
    now = new Date('2026-07-06T12:00:00.000Z');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loads quotas and reports status', () => {
    fs.writeFileSync(
      quotaPath,
      [
        'quotas:',
        '  - scope: user',
        '    type: tokens',
        '    period: daily',
        '    limit: 1000',
        '    used: 250',
        '  - scope: project',
        '    type: cost',
        '    period: monthly',
        '    limit: 100',
        '    used: 10.5',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new QuotaManager(quotaPath, () => now);

    expect(manager.loadQuotas()).toEqual([
      { scope: 'user', type: 'tokens', period: 'daily', limit: 1000, used: 250 },
      { scope: 'project', type: 'cost', period: 'monthly', limit: 100, used: 10.5 },
    ]);
    expect(manager.checkQuota('user', 'tokens')).toEqual({
      quota: { scope: 'user', type: 'tokens', period: 'daily', limit: 1000, used: 250 },
      remaining: 750,
      percentUsed: 25,
      exceeded: false,
      resetAt: '2026-07-07T00:00:00.000Z',
    });
  });

  it('records usage, resets quotas, and formats output', () => {
    fs.writeFileSync(
      quotaPath,
      [
        'quotas:',
        '  - scope: org',
        '    type: tokens',
        '    period: weekly',
        '    limit: 500',
        '    used: 490',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new QuotaManager(quotaPath, () => now);

    expect(manager.recordUsage('org', 'tokens', 25)).toEqual({
      quota: { scope: 'org', type: 'tokens', period: 'weekly', limit: 500, used: 515 },
      remaining: 0,
      percentUsed: 103,
      exceeded: true,
      resetAt: '2026-07-13T00:00:00.000Z',
    });

    const statuses = manager.getStatus();
    expect(formatQuotaStatus(statuses)).toContain('org:tokens');
    expect(formatQuotaStatus(statuses)).toContain('exceeded');

    expect(manager.resetQuota('org', 'tokens')).toEqual({
      quota: { scope: 'org', type: 'tokens', period: 'weekly', limit: 500, used: 0 },
      remaining: 500,
      percentUsed: 0,
      exceeded: false,
      resetAt: '2026-07-13T00:00:00.000Z',
    });
  });
});
