import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES,
  formatComplianceResult,
  listProfiles,
  runComplianceCheck,
} from '../../src/governance/compliance.js';

describe('compliance', () => {
  let tmpRoot: string;
  let workspace: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-governance-compliance');
    fs.mkdirSync(tmpRoot, { recursive: true });
    workspace = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes builtin profiles when required governance files exist', () => {
    const governanceDir = path.join(workspace, '.icopilot');
    fs.mkdirSync(governanceDir, { recursive: true });
    fs.writeFileSync(
      path.join(governanceDir, 'org.yaml'),
      [
        'name: Compliance Org',
        'defaults: {}',
        'policies:',
        '  - enforce-encryption',
        '  - no-pii-in-logs',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(governanceDir, 'audit-stream.yaml'),
      ['enabled: true', 'sinks:', '  - type: stdout', '    config: {}', ''].join('\n'),
      'utf8',
    );

    const result = runComplianceCheck(BUILTIN_PROFILES.SOC2, { cwd: workspace });

    expect(result).toEqual({
      profile: 'SOC2',
      passed: ['require-audit-log', 'enforce-encryption', 'no-pii-in-logs'],
      failed: [],
      warnings: [],
      score: 100,
    });
    expect(formatComplianceResult(result)).toContain('SOC2');
    expect(listProfiles().map((profile) => profile.name)).toEqual(['SOC2', 'HIPAA']);
  });

  it('fails builtin profile rules when governance controls are missing', () => {
    const result = runComplianceCheck(BUILTIN_PROFILES.HIPAA, { cwd: workspace });

    expect(result).toEqual({
      profile: 'HIPAA',
      passed: [],
      failed: ['require-audit-log', 'enforce-encryption', 'no-pii-in-logs'],
      warnings: [],
      score: 0,
    });
  });
});
