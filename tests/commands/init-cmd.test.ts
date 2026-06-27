import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from '../../src/commands/init-cmd.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-init-cmd-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('initProject', () => {
  it('creates the project config directory and default files', () => {
    const result = initProject(tmpDir);

    expect(result.cwd).toBe(tmpDir);
    expect(result.created).toEqual([
      '.icopilot/',
      '.icopilot/agents/',
      '.icopilot/policy.json',
      '.icopilot/memory.md',
      '.icopilot/team-memory.md',
      '.icopilot/roles.yaml',
    ]);
    expect(result.skipped).toEqual([]);

    expect(fs.existsSync(path.join(tmpDir, '.icopilot', 'agents'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'policy.json'), 'utf8')).toBe(
      '{\n  "allowShell": true,\n  "allowWrite": true,\n  "denyTools": []\n}\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'memory.md'), 'utf8')).toBe(
      '<!-- Project memory: add notes the AI should always know about this project -->\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'team-memory.md'), 'utf8')).toBe(
      '# Team memory\n\n<!-- Shared team memory for conventions, decisions, tips, and warnings. -->\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'roles.yaml'), 'utf8')).toContain(
      'currentRole: developer',
    );
  });

  it('is idempotent and skips existing files on a second run', () => {
    initProject(tmpDir);

    const second = initProject(tmpDir);

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual([
      '.icopilot/',
      '.icopilot/agents/',
      '.icopilot/policy.json',
      '.icopilot/memory.md',
      '.icopilot/team-memory.md',
      '.icopilot/roles.yaml',
    ]);
  });

  it('overwrites existing files when force is enabled', () => {
    initProject(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.icopilot', 'policy.json'),
      '{"allowShell":false}\n',
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, '.icopilot', 'memory.md'), 'custom notes\n', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, '.icopilot', 'team-memory.md'),
      'custom team memory\n',
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, '.icopilot', 'roles.yaml'), 'currentRole: viewer\n', 'utf8');

    const result = initProject(tmpDir, { force: true });

    expect(result.created).toEqual([
      '.icopilot/policy.json',
      '.icopilot/memory.md',
      '.icopilot/team-memory.md',
      '.icopilot/roles.yaml',
    ]);
    expect(result.skipped).toEqual(['.icopilot/', '.icopilot/agents/']);
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'policy.json'), 'utf8')).toBe(
      '{\n  "allowShell": true,\n  "allowWrite": true,\n  "denyTools": []\n}\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'memory.md'), 'utf8')).toBe(
      '<!-- Project memory: add notes the AI should always know about this project -->\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'team-memory.md'), 'utf8')).toBe(
      '# Team memory\n\n<!-- Shared team memory for conventions, decisions, tips, and warnings. -->\n',
    );
    expect(fs.readFileSync(path.join(tmpDir, '.icopilot', 'roles.yaml'), 'utf8')).toContain(
      'currentRole: developer',
    );
  });
});
