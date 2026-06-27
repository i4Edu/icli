import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RetentionManager,
  type RetentionPolicy,
  retentionConfigPath,
} from '../../src/security/retention.js';

describe('RetentionManager', () => {
  let tmpRoot: string;
  let tempDir: string;
  let configPath: string;
  let sessionsDir: string;
  let memoryDir: string;
  let auditPath: string;
  let now: Date;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-retention-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    configPath = path.join(tempDir, '.icopilot', 'retention.yaml');
    sessionsDir = path.join(tempDir, 'sessions');
    memoryDir = path.join(tempDir, 'memory');
    auditPath = path.join(tempDir, 'stats.json');
    now = new Date('2026-06-27T00:00:00.000Z');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('persists policies to retention.yaml', () => {
    const manager = createManager();

    const policies = manager.setPolicy({
      target: 'sessions',
      maxAgeDays: 30,
      enabled: true,
    });

    expect(policies).toEqual([
      {
        target: 'sessions',
        maxAgeDays: 30,
        enabled: true,
      },
    ]);
    expect(fs.existsSync(configPath)).toBe(true);

    const reloaded = createManager().loadPolicies();
    expect(reloaded).toEqual(policies);
  });

  it('applies age and count rules in preview and getExpired', () => {
    const manager = createManager();
    manager.setPolicy({ target: 'sessions', maxAgeDays: 30, maxCount: 1, enabled: true });
    manager.setPolicy({ target: 'memory', maxAgeDays: 15, enabled: true });
    manager.setPolicy({ target: 'all', maxAgeDays: 7, enabled: true });

    const newestSession = touch(path.join(sessionsDir, 'newest.json'), 2);
    const oldSession = touch(path.join(sessionsDir, 'old.json'), 45);
    const oldMemory = touch(path.join(memoryDir, 'project-a.json'), 20);
    const freshMemory = touch(path.join(memoryDir, 'project-b.json'), 5);
    const oldAudit = touch(auditPath, 9);

    const sessionExpired = manager.getExpired('sessions');
    expect(sessionExpired).toHaveLength(1);
    expect(sessionExpired[0]?.path).toBe(oldSession);
    expect(sessionExpired[0]?.reasons).toEqual(expect.arrayContaining(['age', 'count']));

    const preview = manager.preview();
    expect(preview.expired.map((entry) => entry.path).sort()).toEqual(
      [oldSession, oldMemory, oldAudit].sort(),
    );
    expect(preview.totals.sessions).toEqual({ scanned: 2, expired: 1 });
    expect(preview.totals.memory).toEqual({ scanned: 2, expired: 1 });
    expect(preview.totals.audit).toEqual({ scanned: 1, expired: 1 });

    expect(fs.existsSync(newestSession)).toBe(true);
    expect(fs.existsSync(freshMemory)).toBe(true);
  });

  it('deletes expired items on enforce', () => {
    const manager = createManager();
    manager.setPolicy({ target: 'all', maxAgeDays: 10, enabled: true });

    const expiredSession = touch(path.join(sessionsDir, 'expired.json'), 11);
    const expiredMemory = touch(path.join(memoryDir, 'expired-memory.json'), 12);
    const freshAudit = touch(auditPath, 1);

    const result = manager.enforce();

    expect(result.deleted.map((entry) => entry.path).sort()).toEqual([expiredSession, expiredMemory].sort());
    expect(result.errors).toEqual([]);
    expect(fs.existsSync(expiredSession)).toBe(false);
    expect(fs.existsSync(expiredMemory)).toBe(false);
    expect(fs.existsSync(freshAudit)).toBe(true);
  });

  it('returns the default config path shape', () => {
    expect(retentionConfigPath()).toMatch(/\.icopilot[\\/]+retention\.yaml$/);
  });

  function createManager(): RetentionManager {
    return new RetentionManager({
      configPath,
      sessionDir: sessionsDir,
      memoryDir,
      auditPath,
      now: () => now,
    });
  }

  function touch(filePath: string, ageDays: number): string {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${path.basename(filePath)}\n`, 'utf8');
    const modifiedAt = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, modifiedAt, modifiedAt);
    return filePath;
  }
});
