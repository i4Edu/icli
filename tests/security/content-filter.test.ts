import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import {
  ContentFilter,
  builtinFilterRules,
  loadProjectContentFilter,
  removeProjectFilterRule,
  saveProjectFilterRule,
} from '../../src/security/content-filter.js';
import { defaultContext } from '../../src/util/completion.js';

describe('content filter', () => {
  let tmpRoot: string;
  let tmpDir: string;
  let originalCwd: string;
  let originalQuiet: boolean;
  let originalJsonOutput: boolean;
  let originalSessionDir: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-content-filter-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    originalCwd = config.cwd;
    originalQuiet = config.quiet;
    originalJsonOutput = config.jsonOutput;
    originalSessionDir = config.sessionDir;
    config.cwd = tmpDir;
    config.quiet = true;
    config.jsonOutput = false;
    config.sessionDir = path.join(tmpDir, '.sessions');
  });

  afterEach(() => {
    config.cwd = originalCwd;
    config.quiet = originalQuiet;
    config.jsonOutput = originalJsonOutput;
    config.sessionDir = originalSessionDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('redacts built-in PII matches', () => {
    const filter = new ContentFilter(builtinFilterRules());
    const result = filter.filter('Email me at jane@example.com or call 555-123-4567.');

    expect(result.blocked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.redactions).toBe(2);
    expect(result.filtered).toContain('[REDACTED:EMAIL]');
    expect(result.filtered).toContain('[REDACTED:PHONE]');
  });

  it('blocks built-in secret and payment data matches', () => {
    const filter = new ContentFilter(builtinFilterRules());
    const result = filter.filter(
      'Use key sk-123456789012345678901234567890 and card 4242 4242 4242 4242',
    );

    expect(result.blocked).toBe(true);
    expect(result.blocks).toBeGreaterThanOrEqual(2);
    expect(result.filtered).toContain('[BLOCKED:API_KEY]');
    expect(result.filtered).toContain('[BLOCKED:CARD]');
  });

  it('supports custom rule add/remove operations', () => {
    const filter = new ContentFilter();

    filter.addRule({
      name: 'ticket-id',
      pattern: /ACME-\d+/g,
      type: 'custom',
      action: 'warn',
    });

    expect(filter.scan('Reference ACME-42')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ticket-id', action: 'warn' })]),
    );

    expect(filter.removeRule('ticket-id')).toBe(true);
    expect(filter.scan('Reference ACME-42')).toHaveLength(0);
  });

  it('loads, persists, and removes project filter rules', () => {
    saveProjectFilterRule(tmpDir, {
      name: 'ticket-id',
      pattern: /ACME-\d+/g,
      type: 'custom',
      action: 'warn',
    });

    let filter = loadProjectContentFilter(tmpDir);
    expect(filter.scan('Reference ACME-42')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ticket-id', action: 'warn' })]),
    );

    expect(removeProjectFilterRule(tmpDir, 'ticket-id')).toEqual({
      removed: true,
      source: 'custom',
    });
    filter = loadProjectContentFilter(tmpDir);
    expect(filter.scan('Reference ACME-42')).toHaveLength(0);

    expect(removeProjectFilterRule(tmpDir, 'email')).toEqual({ removed: true, source: 'builtin' });
    filter = loadProjectContentFilter(tmpDir);
    expect(filter.scan('jane@example.com')).toHaveLength(0);
  });

  it('adds /filter to shell completion context', () => {
    const ctx = defaultContext(tmpDir);
    expect(ctx.slashCommands).toContain('filter');
  });
});
