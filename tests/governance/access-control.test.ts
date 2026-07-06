import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessController, formatAccessDenied } from '../../src/governance/access-control.js';

describe('access-control', () => {
  let tmpRoot: string;
  let workspace: string;
  let policyPath: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-governance-access');
    fs.mkdirSync(tmpRoot, { recursive: true });
    workspace = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    policyPath = path.join(workspace, '.icopilot', 'access.yaml');
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loads policies and enforces strict command/tool denies', () => {
    fs.writeFileSync(
      policyPath,
      [
        'defaultRole: developer',
        'enforceMode: strict',
        'rules:',
        '  - role: reviewer',
        '    allowCommands:',
        '      - status',
        '    denyCommands:',
        '      - release',
        '    allowTools:',
        '      - view',
        '      - rg*',
        '    denyTools:',
        '      - bash',
        '',
      ].join('\n'),
      'utf8',
    );

    const controller = new AccessController(policyPath);
    const policy = controller.loadPolicy();
    controller.setRole('reviewer');

    expect(policy.enforceMode).toBe('strict');
    expect(controller.checkCommand('/status')).toEqual({ allowed: true, enforced: false });
    expect(controller.checkCommand('release')).toEqual({
      allowed: false,
      enforced: true,
      reason: 'command "release" is denied for role "reviewer"',
    });
    expect(controller.checkTool('rg-files')).toEqual({ allowed: true, enforced: false });
    expect(controller.checkTool('bash')).toEqual({
      allowed: false,
      enforced: true,
      reason: 'tool "bash" is denied for role "reviewer"',
    });
  });

  it('treats warn mode as advisory', () => {
    fs.writeFileSync(
      policyPath,
      [
        'defaultRole: analyst',
        'enforceMode: warn',
        'rules:',
        '  - role: analyst',
        '    allowTools:',
        '      - view',
        '',
      ].join('\n'),
      'utf8',
    );

    const controller = new AccessController(policyPath);
    controller.loadPolicy();

    expect(controller.checkTool('edit')).toEqual({
      allowed: true,
      enforced: false,
      reason: 'tool "edit" is not allow-listed for role "analyst"',
    });
    expect(formatAccessDenied('edit', 'analyst', controller.getCurrentPolicy())).toContain(
      'analyst',
    );
  });

  it('falls back to permissive defaults when no policy file exists', () => {
    const controller = new AccessController(path.join(workspace, '.icopilot', 'missing.yaml'));
    const policy = controller.loadPolicy();

    expect(policy).toEqual({ defaultRole: 'developer', enforceMode: 'permissive', rules: [] });
    expect(controller.checkCommand('anything')).toEqual({ allowed: true, enforced: false });
  });
});
