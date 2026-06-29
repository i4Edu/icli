import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuditLogger', () => {
  let tmpRoot: string;
  let tmpDir: string;
  let auditPath: string;
  let originalAuditPath: string | undefined;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-audit-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    auditPath = path.join(tmpDir, '.icopilot', 'audit.log');
    originalAuditPath = process.env.ICOPILOT_AUDIT_PATH;
    process.env.ICOPILOT_AUDIT_PATH = auditPath;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalAuditPath === undefined) delete process.env.ICOPILOT_AUDIT_PATH;
    else process.env.ICOPILOT_AUDIT_PATH = originalAuditPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('logs entries, filters them, and reports stats', async () => {
    const { AuditLogger } = await import('../../src/security/audit.js');
    const logger = new AuditLogger(auditPath);

    logger.log({
      action: 'tool.execute',
      tool: 'grep',
      args: { pattern: 'audit' },
      result: 'success',
      duration: 11,
    });
    logger.log({
      action: 'tool.execute',
      tool: 'run_shell',
      command: 'npm test',
      result: 'failure',
      duration: 97,
      details: 'exit code 1',
    });
    logger.log({
      action: 'tool.execute',
      tool: 'write_file',
      args: { path: 'src/a.ts' },
      result: 'denied',
      details: 'policy denied',
    });

    expect(fs.existsSync(auditPath)).toBe(true);
    expect(fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/u)).toHaveLength(3);
    expect(logger.query({ tool: 'grep' })).toHaveLength(1);
    expect(logger.query({ result: 'failure' })[0]?.command).toBe('npm test');
    expect(logger.getRecent(2).map((entry) => entry.tool)).toEqual(['write_file', 'run_shell']);

    expect(logger.getStats()).toEqual(
      expect.objectContaining({
        total: 3,
        success: 1,
        failure: 1,
        denied: 1,
        byTool: expect.objectContaining({
          grep: 1,
          run_shell: 1,
          write_file: 1,
        }),
        avgDuration: 54,
      }),
    );
  });

  it('exports logs and rotates old entries', async () => {
    const { AuditLogger } = await import('../../src/security/audit.js');
    const logger = new AuditLogger(auditPath);
    const now = Date.now();

    logger.log({
      timestamp: new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString(),
      action: 'tool.execute',
      tool: 'grep',
      result: 'success',
    });
    logger.log({
      timestamp: new Date(now).toISOString(),
      action: 'tool.execute',
      tool: 'run_in_terminal',
      command: 'npm run build',
      result: 'success',
    });

    const exportedJson = path.join(tmpDir, 'audit-export.json');
    const exportedJsonl = path.join(tmpDir, 'audit-export.log');
    logger.export(exportedJson, 'json');
    logger.export(exportedJsonl, 'jsonl');

    expect(JSON.parse(fs.readFileSync(exportedJson, 'utf8'))).toHaveLength(2);
    expect(fs.readFileSync(exportedJsonl, 'utf8').trim().split(/\r?\n/u)).toHaveLength(2);

    expect(logger.rotate(7 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(logger.query().map((entry) => entry.tool)).toEqual(['run_in_terminal']);
  });

  it('wires audit slash commands and completion metadata', async () => {
    const { defaultContext } = await import('../../src/util/completion.js');
    const slashSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'commands', 'slash.ts'),
      'utf8',
    );

    expect(slashSource).toContain("case 'audit':");
    expect(slashSource).toContain('/audit search <query>');
    expect(slashSource).toContain('/audit stats');
    expect(slashSource).toContain('/audit export [path]');
    expect(defaultContext(tmpDir).slashCommands).toContain('audit');
  });
});
