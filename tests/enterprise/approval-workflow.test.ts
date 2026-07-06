import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApprovalWorkflow,
  formatApprovalRequest,
  loadApprovalGates,
} from '../../src/enterprise/approval-workflow.js';

describe('ApprovalWorkflow', () => {
  let testRoot = '';
  let cwd = '';

  beforeEach(() => {
    testRoot = path.join(
      process.cwd(),
      '.test-artifacts',
      'enterprise',
      'approval-workflow',
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    cwd = path.join(testRoot, 'repo');
    fs.mkdirSync(path.join(cwd, '.icopilot', 'enterprise'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('loads approval gates from yaml', () => {
    fs.writeFileSync(
      path.join(cwd, '.icopilot', 'enterprise', 'approval-gates.yaml'),
      [
        'gates:',
        '  - id: prod',
        '    name: Production Deploy',
        '    trigger: deploy:prod:*',
        '    requiredApprovers: 2',
        '    timeout: 3600',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(loadApprovalGates(cwd)).toEqual([
      {
        id: 'prod',
        name: 'Production Deploy',
        trigger: 'deploy:prod:*',
        requiredApprovers: 2,
        timeout: 3600,
        escalation: undefined,
      },
    ]);
  });

  it('requests, approves, denies, and formats approvals', () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const workflow = new ApprovalWorkflow({
      now: () => now,
      gates: [
        {
          id: 'prod',
          name: 'Production Deploy',
          trigger: 'deploy:prod:*',
          requiredApprovers: 2,
          timeout: 60,
        },
      ],
    });

    const request = workflow.requestApproval('deploy:prod:web', {
      requestedBy: 'alice',
      service: 'web',
    });
    expect(request.status).toBe('pending');
    expect(workflow.checkGate('deploy:prod:web')?.id).toBe('prod');
    expect(workflow.getPending()).toHaveLength(1);

    const firstApproval = workflow.approve(request.id, {
      userId: 'lead-1',
      decision: 'approve',
      timestamp: now.toISOString(),
    });
    expect(firstApproval.status).toBe('pending');

    const approved = workflow.approve(request.id, {
      userId: 'lead-2',
      decision: 'approve',
      timestamp: now.toISOString(),
      comment: 'safe to ship',
    });
    expect(approved.status).toBe('approved');
    expect(formatApprovalRequest(approved)).toContain('safe to ship');

    const deniedRequest = workflow.requestApproval('deploy:prod:api', {
      requestedBy: 'bob',
    });
    const denied = workflow.deny(deniedRequest.id, {
      userId: 'security',
      decision: 'deny',
      timestamp: now.toISOString(),
      comment: 'change freeze',
    });
    expect(denied.status).toBe('denied');
    expect(workflow.getHistory(1)[0]?.id).toBe(denied.id);

    now = new Date('2026-01-01T00:02:00.000Z');
    const expiring = workflow.requestApproval('deploy:prod:batch', {
      requestedBy: 'carol',
    });
    now = new Date('2026-01-01T00:03:30.000Z');
    expect(workflow.getPending().map((entry) => entry.id)).not.toContain(expiring.id);
    expect(workflow.getHistory().find((entry) => entry.id === expiring.id)?.status).toBe('expired');
  });

  it('auto-approves when no gate matches', () => {
    const workflow = new ApprovalWorkflow();
    const request = workflow.requestApproval('lint:repo', { requestedBy: 'alice' });
    expect(request.status).toBe('approved');
    expect(request.gateId).toBe('auto-approve');
  });
});
