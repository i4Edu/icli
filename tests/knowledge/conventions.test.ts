import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConventionManager,
  loadConventionPromptContext,
  loadConventionSet,
  resolveConventionPath,
} from '../../src/knowledge/conventions.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-conventions-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ConventionManager', () => {
  it('detects conventions from project code', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'index.ts'),
      [
        "import fs from 'node:fs';",
        "import type { Stats } from 'node:fs';",
        '',
        'export function readConfig(): Stats | null {',
        "  const key = 'ready';",
        '  return fs.existsSync(key) ? fs.statSync(key) : null;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'tests', 'index.test.ts'),
      [
        "import { describe, expect, it } from 'vitest';",
        "import { readConfig } from '../src/index.js';",
        '',
        "describe('readConfig', () => {",
        "  it('returns null for missing files', () => {",
        '    expect(readConfig()).toBeNull();',
        '  });',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new ConventionManager();
    const detected = manager.detect(tmpDir);
    const ids = detected.map((convention) => convention.id);

    expect(ids).toContain('use-semicolons');
    expect(ids).toContain('prefer-single-quotes');
    expect(ids).toContain('use-esm-imports');
    expect(ids).toContain('prefer-node-protocol-imports');
    expect(ids).toContain('prefer-type-imports');
    expect(ids).toContain('use-vitest-for-tests');
  });

  it('persists conventions and renders prompt context', () => {
    const manager = new ConventionManager();
    manager.add({
      id: 'prefer-single-quotes',
      name: 'Prefer single quotes',
      description: 'Use single-quoted strings.',
      rule: 'Use single quotes for strings.',
      example: "const label = 'ready';",
      severity: 'recommended',
    });
    manager.add({
      id: 'use-semicolons',
      name: 'Use semicolons',
      description: 'Terminate statements with semicolons.',
      rule: 'End statements with semicolons.',
      severity: 'required',
    });
    manager.save(tmpDir);

    expect(fs.existsSync(resolveConventionPath(tmpDir))).toBe(true);
    expect(loadConventionSet(tmpDir)?.conventions).toHaveLength(2);

    const reloaded = new ConventionManager();
    const set = reloaded.load(tmpDir);
    expect(set.name).toContain('conventions');
    expect(set.conventions.map((convention) => convention.id)).toEqual([
      'use-semicolons',
      'prefer-single-quotes',
    ]);

    reloaded.remove('prefer-single-quotes');
    expect(reloaded.getConventionSet().conventions).toHaveLength(1);
    expect(loadConventionPromptContext(tmpDir)).toContain('Use semicolons');
  });

  it('checks code against supported conventions', () => {
    const manager = new ConventionManager({
      name: 'Project conventions',
      conventions: [
        {
          id: 'use-semicolons',
          name: 'Use semicolons',
          description: 'Terminate statements with semicolons.',
          rule: 'End statements with semicolons.',
          severity: 'required',
        },
        {
          id: 'prefer-single-quotes',
          name: 'Prefer single quotes',
          description: 'Use single-quoted strings.',
          rule: 'Use single quotes for strings.',
          severity: 'recommended',
        },
        {
          id: 'use-esm-imports',
          name: 'Use ESM imports',
          description: 'Prefer ES module syntax.',
          rule: 'Use import/export syntax instead of require/module.exports.',
          severity: 'required',
        },
        {
          id: 'prefer-node-protocol-imports',
          name: 'Prefer node: protocol imports',
          description: 'Use node: protocol for built-ins.',
          rule: 'Import built-in modules using the node: protocol.',
          severity: 'recommended',
        },
      ],
    });

    const violations = manager.check(
      ['const value = "Ada"', "const fs = require('fs')", 'module.exports = { value }', ''].join(
        '\n',
      ),
    );

    expect(violations.length).toBeGreaterThanOrEqual(4);
    expect(violations.some((violation) => violation.convention.id === 'prefer-single-quotes')).toBe(
      true,
    );
    expect(violations.some((violation) => violation.convention.id === 'use-semicolons')).toBe(true);
    expect(violations.some((violation) => violation.convention.id === 'use-esm-imports')).toBe(
      true,
    );
    expect(
      violations.some((violation) => violation.convention.id === 'prefer-node-protocol-imports'),
    ).toBe(true);
    expect(violations.every((violation) => typeof violation.line === 'number')).toBe(true);
  });

  it('supports regex-driven custom checks', () => {
    const manager = new ConventionManager();
    manager.add({
      id: 'forbid-console-log',
      name: 'Forbid console.log',
      description: 'Disallow console.log in committed code.',
      rule: 'forbid:console\\.log',
      severity: 'optional',
    });

    const violations = manager.check("console.log('debug');\n");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('Forbidden pattern matched');
  });
});
