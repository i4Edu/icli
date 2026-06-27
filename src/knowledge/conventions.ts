import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { parse, stringify } from 'yaml';

export interface Convention {
  id: string;
  name: string;
  description: string;
  rule: string;
  example?: string;
  severity: 'required' | 'recommended' | 'optional';
}

export interface ConventionSet {
  name: string;
  conventions: Convention[];
}

export interface ConventionViolation {
  convention: Convention;
  file?: string;
  line?: number;
  description: string;
}

const CONVENTION_PATTERNS = [
  'src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'tests/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
];

const CONVENTION_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.icopilot/**', '**/coverage/**'];
const BUILTIN_MODULES = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'timers',
  'tty',
  'url',
  'util',
  'zlib',
]);

interface DetectionStats {
  singleQuotes: number;
  doubleQuotes: number;
  semicolonsAlways: number;
  semicolonsNever: number;
  esmImports: number;
  nodeProtocolImports: number;
  builtinImports: number;
  typeImports: number;
  vitestImports: number;
}

export class ConventionManager {
  private set: ConventionSet;

  constructor(initialSet: ConventionSet = { name: 'Project conventions', conventions: [] }) {
    this.set = normalizeConventionSet(initialSet, initialSet.name || 'Project conventions');
  }

  load(rootDir: string): ConventionSet {
    const filePath = resolveConventionPath(rootDir);
    if (!fs.existsSync(filePath)) {
      this.set = emptyConventionSet(rootDir);
      return this.getConventionSet();
    }

    const parsed = parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    this.set = normalizeConventionSet(parsed, emptyConventionSet(rootDir).name);
    return this.getConventionSet();
  }

  detect(rootDir: string): Convention[] {
    const stats = collectDetectionStats(listConventionFiles(rootDir));
    const detected: Convention[] = [];

    if (stats.semicolonsAlways > 0 && stats.semicolonsAlways >= stats.semicolonsNever) {
      detected.push({
        id: 'use-semicolons',
        name: 'Use semicolons',
        description: 'Terminate statements with semicolons.',
        rule: 'End statements with semicolons.',
        example: "const answer = 42;",
        severity: 'required',
      });
    }

    if (stats.singleQuotes > 0 || stats.doubleQuotes > 0) {
      const prefersSingle = stats.singleQuotes >= stats.doubleQuotes;
      detected.push({
        id: prefersSingle ? 'prefer-single-quotes' : 'prefer-double-quotes',
        name: prefersSingle ? 'Prefer single quotes' : 'Prefer double quotes',
        description: prefersSingle
          ? 'Use single-quoted strings unless escaping would be noisier.'
          : 'Use double-quoted strings unless escaping would be noisier.',
        rule: prefersSingle ? 'Use single quotes for strings.' : 'Use double quotes for strings.',
        example: prefersSingle ? "const label = 'ready';" : 'const label = "ready";',
        severity: 'recommended',
      });
    }

    if (stats.esmImports > 0) {
      detected.push({
        id: 'use-esm-imports',
        name: 'Use ESM imports',
        description: 'Prefer native ES module imports and exports.',
        rule: 'Use import/export syntax instead of require/module.exports.',
        example: "import fs from 'node:fs';",
        severity: 'required',
      });
    }

    if (stats.nodeProtocolImports > 0 && stats.nodeProtocolImports >= Math.max(1, Math.floor(stats.builtinImports / 2))) {
      detected.push({
        id: 'prefer-node-protocol-imports',
        name: 'Prefer node: protocol imports',
        description: 'Use the node: protocol for Node.js built-in modules.',
        rule: 'Import built-in modules using the node: protocol.',
        example: "import path from 'node:path';",
        severity: 'recommended',
      });
    }

    if (stats.typeImports > 0) {
      detected.push({
        id: 'prefer-type-imports',
        name: 'Prefer type-only imports',
        description: 'Use import type for TypeScript-only type imports when possible.',
        rule: 'Prefer import type for type-only dependencies.',
        example: "import type { Session } from './session.js';",
        severity: 'recommended',
      });
    }

    if (stats.vitestImports > 0) {
      detected.push({
        id: 'use-vitest-for-tests',
        name: 'Use Vitest for tests',
        description: 'Project tests are written with Vitest.',
        rule: 'Write unit tests with Vitest APIs and imports.',
        example: "import { describe, expect, it } from 'vitest';",
        severity: 'recommended',
      });
    }

    return detected.sort(compareConventions);
  }

  add(convention: Convention): void {
    const normalized = normalizeConvention(convention);
    const next = this.set.conventions.filter((entry) => entry.id !== normalized.id);
    next.push(normalized);
    this.set = {
      name: this.set.name,
      conventions: next.sort(compareConventions),
    };
  }

  remove(id: string): void {
    const normalizedId = slugify(id);
    this.set = {
      name: this.set.name,
      conventions: this.set.conventions.filter((entry) => entry.id !== normalizedId),
    };
  }

  check(code: string): ConventionViolation[] {
    const violations: ConventionViolation[] = [];
    for (const convention of this.set.conventions) {
      violations.push(...checkConvention(code, convention));
    }
    return violations.sort((left, right) => (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER));
  }

  toPromptContext(): string {
    if (this.set.conventions.length === 0) return '';
    return [
      `Follow the ${this.set.name} when generating or editing code:`,
      ...this.set.conventions.map((convention) => {
        const example = convention.example ? ` Example: ${convention.example}` : '';
        return `- [${convention.severity}] ${convention.name}: ${convention.rule}${example}`;
      }),
    ].join('\n');
  }

  save(rootDir: string): void {
    const filePath = resolveConventionPath(rootDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${stringify(this.set).trimEnd()}\n`, 'utf8');
  }

  getConventionSet(): ConventionSet {
    return {
      name: this.set.name,
      conventions: this.set.conventions.map((convention) => ({ ...convention })),
    };
  }
}

export function listConventionFiles(rootDir: string): string[] {
  return fg.sync(CONVENTION_PATTERNS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    unique: true,
    ignore: CONVENTION_IGNORE,
  });
}

export function resolveConventionPath(rootDir: string): string {
  return path.join(rootDir, '.icopilot', 'conventions.yaml');
}

export function loadConventionSet(rootDir: string): ConventionSet | null {
  const filePath = resolveConventionPath(rootDir);
  if (!fs.existsSync(filePath)) return null;
  const manager = new ConventionManager();
  return manager.load(rootDir);
}

export function loadConventionPromptContext(rootDir: string): string | null {
  const filePath = resolveConventionPath(rootDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const manager = new ConventionManager();
    manager.load(rootDir);
    return manager.toPromptContext();
  } catch {
    return null;
  }
}

function emptyConventionSet(rootDir: string): ConventionSet {
  const baseName = path.basename(rootDir) || 'project';
  return {
    name: `${baseName} conventions`,
    conventions: [],
  };
}

function normalizeConventionSet(value: unknown, fallbackName: string): ConventionSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { name: fallbackName, conventions: [] };
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackName;
  const conventions = Array.isArray(record.conventions)
    ? record.conventions
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => normalizeConvention(entry as Convention))
        .sort(compareConventions)
    : [];

  return { name, conventions };
}

function normalizeConvention(value: Convention): Convention {
  const severity = normalizeSeverity(value.severity);
  const name = value.name.trim();
  const description = value.description.trim();
  const rule = value.rule.trim();
  if (!name || !description || !rule) {
    throw new Error('convention name, description, and rule are required');
  }

  return {
    id: slugify(value.id || value.name),
    name,
    description,
    rule,
    example: value.example?.trim() || undefined,
    severity,
  };
}

function normalizeSeverity(value: Convention['severity'] | string | undefined): Convention['severity'] {
  if (value === 'required' || value === 'recommended' || value === 'optional') return value;
  return 'recommended';
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'convention';
}

function compareConventions(left: Convention, right: Convention): number {
  return severityRank(left.severity) - severityRank(right.severity) || left.name.localeCompare(right.name);
}

function severityRank(severity: Convention['severity']): number {
  switch (severity) {
    case 'required':
      return 0;
    case 'recommended':
      return 1;
    case 'optional':
    default:
      return 2;
  }
}

function collectDetectionStats(files: string[]): DetectionStats {
  const stats: DetectionStats = {
    singleQuotes: 0,
    doubleQuotes: 0,
    semicolonsAlways: 0,
    semicolonsNever: 0,
    esmImports: 0,
    nodeProtocolImports: 0,
    builtinImports: 0,
    typeImports: 0,
    vitestImports: 0,
  };

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    stats.singleQuotes += source.match(/'([^'\\]|\\.)*'/g)?.length ?? 0;
    stats.doubleQuotes += source.match(/"([^"\\]|\\.)*"/g)?.length ?? 0;
    stats.esmImports += source.match(/^\s*(?:import|export)\s/mg)?.length ?? 0;
    stats.nodeProtocolImports += source.match(/from\s+['"]node:[^'"]+['"]/g)?.length ?? 0;
    stats.typeImports += source.match(/^\s*import\s+type\b/mg)?.length ?? 0;
    stats.vitestImports += source.match(/from\s+['"]vitest['"]/g)?.length ?? 0;

    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!looksLikeStatement(trimmed)) continue;
      if (/;\s*(?:\/\/.*)?$/.test(trimmed)) {
        stats.semicolonsAlways += 1;
      } else {
        stats.semicolonsNever += 1;
      }
    }

    for (const match of source.matchAll(/(?:from\s+['"]|require\(\s*['"])([^'"]+)(?:['"]\s*\)?)/g)) {
      const moduleName = match[1];
      if (!moduleName || moduleName.startsWith('node:')) continue;
      if (BUILTIN_MODULES.has(moduleName)) {
        stats.builtinImports += 1;
      }
    }
  }

  return stats;
}

function checkConvention(code: string, convention: Convention): ConventionViolation[] {
  const lowered = `${convention.id} ${convention.name} ${convention.description} ${convention.rule}`.toLowerCase();
  if (lowered.includes('forbid:') || lowered.includes('forbid-regex:')) {
    return checkForbiddenPattern(code, convention);
  }
  if (lowered.includes('require:') || lowered.includes('require-regex:')) {
    return checkRequiredPattern(code, convention);
  }
  if (lowered.includes('semicolon')) {
    return checkSemicolons(code, convention);
  }
  if (lowered.includes('single quote')) {
    return checkStringQuotes(code, convention, 'single');
  }
  if (lowered.includes('double quote')) {
    return checkStringQuotes(code, convention, 'double');
  }
  if (lowered.includes('esm') || lowered.includes('import/export syntax')) {
    return checkEsmImports(code, convention);
  }
  if (lowered.includes('node:') || lowered.includes('built-in modules using the node: protocol')) {
    return checkNodeProtocolImports(code, convention);
  }
  if (lowered.includes('vitest')) {
    return checkVitest(code, convention);
  }
  return [];
}

function checkForbiddenPattern(code: string, convention: Convention): ConventionViolation[] {
  const expression = extractRulePattern(convention.rule, ['forbid:', 'forbid-regex:']);
  if (!expression) return [];
  const regex = toRegExp(expression);
  if (!regex) return [];
  const violations: ConventionViolation[] = [];
  for (const match of code.matchAll(regex)) {
    const index = match.index ?? 0;
    violations.push({
      convention,
      line: lineNumberAt(code, index),
      description: `Forbidden pattern matched: ${match[0]}`,
    });
  }
  return violations;
}

function checkRequiredPattern(code: string, convention: Convention): ConventionViolation[] {
  const expression = extractRulePattern(convention.rule, ['require:', 'require-regex:']);
  if (!expression) return [];
  const regex = toRegExp(expression);
  if (!regex || regex.test(code)) return [];
  return [
    {
      convention,
      description: `Required pattern was not found: ${expression}`,
    },
  ];
}

function checkSemicolons(code: string, convention: Convention): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  const lines = code.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!looksLikeStatement(trimmed) || /;\s*(?:\/\/.*)?$/.test(trimmed)) continue;
    violations.push({
      convention,
      line: index + 1,
      description: 'Statement should end with a semicolon.',
    });
  }
  return violations;
}

function checkStringQuotes(code: string, convention: Convention, preferred: 'single' | 'double'): ConventionViolation[] {
  const regex = preferred === 'single' ? /"([^"\\]|\\.)*"/g : /'([^'\\]|\\.)*'/g;
  const violations: ConventionViolation[] = [];
  for (const match of code.matchAll(regex)) {
    const index = match.index ?? 0;
    violations.push({
      convention,
      line: lineNumberAt(code, index),
      description: `Use ${preferred} quotes for strings.`,
    });
  }
  return violations;
}

function checkEsmImports(code: string, convention: Convention): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  for (const match of code.matchAll(/\brequire\(\s*['"][^'"]+['"]\s*\)|\bmodule\.exports\b|\bexports\.[A-Za-z0-9_]+/g)) {
    const index = match.index ?? 0;
    violations.push({
      convention,
      line: lineNumberAt(code, index),
      description: 'Use import/export syntax instead of CommonJS module patterns.',
    });
  }
  return violations;
}

function checkNodeProtocolImports(code: string, convention: Convention): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  for (const match of code.matchAll(/(?:from\s+['"]|require\(\s*['"])([^'"]+)(?:['"]\s*\)?)/g)) {
    const moduleName = match[1];
    if (!moduleName || moduleName.startsWith('node:') || !BUILTIN_MODULES.has(moduleName)) continue;
    const index = match.index ?? 0;
    violations.push({
      convention,
      line: lineNumberAt(code, index),
      description: `Import built-in module "${moduleName}" via the node: protocol.`,
    });
  }
  return violations;
}

function checkVitest(code: string, convention: Convention): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  for (const match of code.matchAll(/from\s+['"](?:@jest\/globals|jest|mocha)['"]/g)) {
    const index = match.index ?? 0;
    violations.push({
      convention,
      line: lineNumberAt(code, index),
      description: 'Use Vitest imports for project tests.',
    });
  }
  return violations;
}

function extractRulePattern(rule: string, prefixes: string[]): string | null {
  const lowered = rule.toLowerCase();
  for (const prefix of prefixes) {
    const start = lowered.indexOf(prefix);
    if (start === -1) continue;
    return rule.slice(start + prefix.length).trim();
  }
  return null;
}

function toRegExp(expression: string): RegExp | null {
  if (!expression) return null;
  const literal = expression.match(/^\/(.+)\/([a-z]*)$/i);
  try {
    if (literal) {
      return new RegExp(literal[1], literal[2].includes('g') ? literal[2] : `${literal[2]}g`);
    }
    return new RegExp(expression, 'g');
  } catch {
    return null;
  }
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function looksLikeStatement(line: string): boolean {
  if (!line) return false;
  if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) return false;
  if (/^[{}[\],]+$/.test(line)) return false;
  if (/[{:,]$/.test(line)) return false;
  return true;
}
