import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aliasCommand,
  aliasesPath,
  deleteAlias,
  loadAliases,
  resolveAlias,
  saveAlias,
} from '../../src/commands/alias-cmd.js';

let tmpDir: string;
let originalAliasesPath: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-alias-cmd-'));
  originalAliasesPath = process.env.ICOPILOT_ALIASES_PATH;
  process.env.ICOPILOT_ALIASES_PATH = path.join(tmpDir, 'aliases.json');
});

afterEach(() => {
  if (originalAliasesPath === undefined) {
    delete process.env.ICOPILOT_ALIASES_PATH;
  } else {
    process.env.ICOPILOT_ALIASES_PATH = originalAliasesPath;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('alias-cmd', () => {
  it('saves, loads, and deletes aliases', () => {
    const saved = saveAlias('fix', '/suggest fix lint errors');

    expect(saved.name).toBe('fix');
    expect(saved.expansion).toBe('/suggest fix lint errors');
    expect(aliasesPath()).toBe(path.join(tmpDir, 'aliases.json'));
    expect(loadAliases()).toEqual([saved]);
    expect(deleteAlias('fix')).toBe(true);
    expect(loadAliases()).toEqual([]);
    expect(deleteAlias('fix')).toBe(false);
  });

  it('resolves matching aliases and ignores non-matching input', () => {
    const aliases = [saveAlias('fix', '/suggest fix lint errors'), saveAlias('fix-tests', '/test')];

    expect(resolveAlias('fix', aliases)).toBe('/suggest fix lint errors');
    expect(resolveAlias('fix src/app.ts', aliases)).toBe('/suggest fix lint errors src/app.ts');
    expect(resolveAlias('fix-tests now', aliases)).toBe('/test now');
    expect(resolveAlias('fixture', aliases)).toBeNull();
    expect(resolveAlias('unknown', aliases)).toBeNull();
  });

  it('validates alias names', () => {
    expect(() => saveAlias('-bad', '/suggest nope')).toThrow(/alias name must match/);
    expect(() => saveAlias('bad name', '/suggest nope')).toThrow(/alias name must match/);
    expect(() => saveAlias('good_name', '   ')).toThrow(/alias expansion is required/);
  });

  it('formats aliasCommand output for list, set, remove, and usage', () => {
    expect(aliasCommand([])).toContain('No aliases saved');

    const setOutput = aliasCommand(['set', 'ship', '/commit']);
    expect(setOutput).toContain('saved alias ship');

    const listOutput = aliasCommand([]);
    expect(listOutput).toContain('Aliases');
    expect(listOutput).toContain('ship');
    expect(listOutput).toContain('/commit');

    const removeOutput = aliasCommand(['remove', 'ship']);
    expect(removeOutput).toContain('deleted alias ship');
    expect(aliasCommand(['wat'])).toContain('usage: /alias');
  });
});
