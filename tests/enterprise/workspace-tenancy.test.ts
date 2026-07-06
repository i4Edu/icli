import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceTenancy,
  formatWorkspaceList,
  loadWorkspaceConfig,
} from '../../src/enterprise/workspace-tenancy.js';

describe('WorkspaceTenancy', () => {
  let testRoot = '';
  let cwd = '';

  beforeEach(() => {
    testRoot = path.join(
      process.cwd(),
      '.test-artifacts',
      'enterprise',
      'workspace-tenancy',
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    cwd = path.join(testRoot, 'repo');
    fs.mkdirSync(path.join(cwd, '.icopilot', 'enterprise'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('loads workspace tenancy config from yaml', () => {
    fs.writeFileSync(
      path.join(cwd, '.icopilot', 'enterprise', 'workspace-tenancy.yaml'),
      ['isolation: shared', 'memorySharing: true', 'policyInheritance: false', ''].join('\n'),
      'utf8',
    );

    expect(loadWorkspaceConfig(cwd)).toEqual({
      isolation: 'shared',
      memorySharing: true,
      policyInheritance: false,
    });
  });

  it('creates, lists, mutates, and deletes workspaces', () => {
    const tenancy = new WorkspaceTenancy({
      isolation: 'strict',
      memorySharing: true,
      policyInheritance: true,
    });

    const workspace = tenancy.createWorkspace({
      id: 'platform',
      name: 'Platform',
      owner: 'alice',
      members: ['bob'],
      policies: ['guardrails'],
    });

    expect(workspace.members).toEqual(['alice', 'bob']);
    expect(tenancy.getWorkspace('platform')).toEqual(workspace);

    tenancy.addMember('platform', 'carol');
    expect(tenancy.getWorkspace('platform')?.members).toEqual(['alice', 'bob', 'carol']);

    tenancy.removeMember('platform', 'bob');
    expect(tenancy.getWorkspace('platform')?.members).toEqual(['alice', 'carol']);

    expect(tenancy.getIsolatedContext('platform')).toEqual({
      workspaceId: 'platform',
      workspaceName: 'Platform',
      isolation: 'strict',
      memoryScope: 'workspace',
      sharedMemory: true,
      inheritedPolicies: true,
      owner: 'alice',
      members: ['alice', 'carol'],
      policies: ['guardrails'],
      cwd: process.cwd(),
    });

    const formatted = formatWorkspaceList(tenancy.listWorkspaces());
    expect(formatted).toContain('Platform');
    expect(formatted).toContain('guardrails');

    expect(tenancy.deleteWorkspace('platform')).toBe(true);
    expect(tenancy.listWorkspaces()).toEqual([]);
  });

  it('protects the owner from removal', () => {
    const tenancy = new WorkspaceTenancy();
    tenancy.createWorkspace({
      id: 'ops',
      name: 'Ops',
      owner: 'alice',
    });

    expect(() => tenancy.removeMember('ops', 'alice')).toThrow('cannot remove workspace owner');
  });
});
