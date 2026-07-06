import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatOrgConfig,
  loadOrgConfig,
  mergeOrgDefaults,
  validateOrgConfig,
} from '../../src/governance/org-config.js';

describe('org-config', () => {
  let tmpRoot: string;
  let workspace: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-governance-org');
    fs.mkdirSync(tmpRoot, { recursive: true });
    workspace = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loads org.yaml from .icopilot', () => {
    const orgPath = path.join(workspace, '.icopilot', 'org.yaml');
    fs.mkdirSync(path.dirname(orgPath), { recursive: true });
    fs.writeFileSync(
      orgPath,
      [
        'name: Example Org',
        'defaults:',
        '  model: gpt-4o-mini',
        '  sandbox: true',
        'policies:',
        '  - enforce-encryption',
        '  - no-pii-in-logs',
        'inheritFrom: enterprise',
        'allowedModels:',
        '  - gpt-4o-mini',
        'deniedTools:',
        '  - run_shell',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(loadOrgConfig(workspace)).toEqual({
      name: 'Example Org',
      defaults: { model: 'gpt-4o-mini', sandbox: true },
      policies: ['enforce-encryption', 'no-pii-in-logs'],
      inheritFrom: 'enterprise',
      allowedModels: ['gpt-4o-mini'],
      deniedTools: ['run_shell'],
    });
  });

  it('merges nested defaults with local config taking precedence', () => {
    const merged = mergeOrgDefaults(
      {
        name: 'Example Org',
        defaults: {
          model: 'gpt-4o-mini',
          execution: { sandbox: true, retries: 1 },
        },
        policies: [],
      },
      {
        execution: { retries: 3 },
        autoApprove: false,
      },
    );

    expect(merged).toEqual({
      model: 'gpt-4o-mini',
      execution: { sandbox: true, retries: 3 },
      autoApprove: false,
    });
  });

  it('validates config shape and formats output', () => {
    expect(
      validateOrgConfig({
        name: 'Example Org',
        defaults: {},
        policies: ['enforce-encryption'],
      }),
    ).toEqual({ valid: true, errors: [] });

    expect(
      validateOrgConfig({
        name: '',
        defaults: [],
        policies: ['ok', ''],
      }),
    ).toEqual({
      valid: false,
      errors: [
        'name must be a non-empty string',
        'defaults must be an object',
        'policies must be an array of non-empty strings',
      ],
    });

    const formatted = formatOrgConfig({
      name: 'Example Org',
      defaults: { model: 'gpt-4o-mini' },
      policies: ['enforce-encryption'],
      deniedTools: ['run_shell'],
    });

    expect(formatted).toContain('Example Org');
    expect(formatted).toContain('enforce-encryption');
    expect(formatted).toContain('run_shell');
    expect(formatted).toContain('model: gpt-4o-mini');
  });
});
