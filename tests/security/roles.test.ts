import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_NAME,
  RoleManager,
  defaultRolesConfigPath,
} from '../../src/security/roles.js';

describe('RoleManager', () => {
  let tmpRoot: string;
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-roles-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    configPath = defaultRolesConfigPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('falls back to built-in roles when no config exists', () => {
    const manager = new RoleManager(configPath);
    const roles = manager.loadRoles(configPath);

    expect(roles.map((role) => role.name)).toEqual(['admin', 'developer', 'reviewer', 'viewer']);
    expect(manager.getCurrentRole().name).toBe(DEFAULT_ROLE_NAME);
  });

  it('persists the selected role to roles.yaml', () => {
    const manager = new RoleManager(configPath);

    manager.loadRoles(configPath);
    manager.setRole('viewer');

    expect(manager.getCurrentRole().name).toBe('viewer');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('currentRole: viewer');
  });

  it('merges custom roles with built-ins and uses the configured current role', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        'currentRole: auditor',
        'roles:',
        '  - name: auditor',
        '    permissions:',
        '      - file:read',
        '      - command:list',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new RoleManager(configPath);

    expect(manager.loadRoles(configPath).map((role) => role.name)).toEqual([
      'admin',
      'developer',
      'reviewer',
      'viewer',
      'auditor',
    ]);
    expect(manager.getCurrentRole().name).toBe('auditor');
    expect(manager.hasPermission('file:read')).toBe(true);
    expect(manager.hasPermission('command:list')).toBe(true);
  });

  it('checks tool access based on the active role', () => {
    const manager = new RoleManager(configPath);

    manager.loadRoles(configPath);
    manager.setRole('reviewer');

    expect(manager.checkAccess('read_file')).toEqual({ allowed: true });
    expect(manager.checkAccess('grep')).toEqual({ allowed: true });
    expect(manager.checkAccess('write_file')).toEqual({
      allowed: false,
      reason: 'role "reviewer" does not permit tool "write_file"',
    });
    expect(manager.checkAccess('run_shell')).toEqual({
      allowed: false,
      reason: 'role "reviewer" does not permit tool "run_shell"',
    });
  });

  it('checks command access using command permissions', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        'currentRole: limited',
        'roles:',
        '  - name: limited',
        '    permissions:',
        '      - command:role',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new RoleManager(configPath);

    manager.loadRoles(configPath);

    expect(manager.checkAccess('/role')).toEqual({ allowed: true });
    expect(manager.checkAccess('command:security')).toEqual({
      allowed: false,
      reason: 'role "limited" does not permit command "security"',
    });
  });
});
