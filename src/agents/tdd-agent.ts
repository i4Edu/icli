import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface TDDSpec {
  description: string;
  inputExamples?: string[];
  expectedBehaviors: string[];
}

export interface TestRunResult {
  passed: number;
  failed: number;
  total: number;
  output: string;
}

export interface TDDResult {
  spec: TDDSpec;
  testFile: string;
  sourceFile: string;
  cycles: number;
  finalStatus: 'green' | 'red';
}

type SupportedFramework = 'vitest' | 'jest' | 'mocha';

interface FrameworkConfig {
  name: SupportedFramework;
  argsForFile: (testFile: string, cwd: string) => string[];
}

interface PlannedFiles {
  slug: string;
  testFile: string;
  sourceFile: string;
}

type PackageJson = {
  scripts?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
};

const FRAMEWORKS: Record<SupportedFramework, FrameworkConfig> = {
  vitest: {
    name: 'vitest',
    argsForFile: (testFile, cwd) => ['vitest', 'run', path.relative(cwd, testFile)],
  },
  jest: {
    name: 'jest',
    argsForFile: (testFile, cwd) => ['jest', '--runInBand', path.relative(cwd, testFile)],
  },
  mocha: {
    name: 'mocha',
    argsForFile: (testFile, cwd) => ['mocha', path.relative(cwd, testFile)],
  },
};

export class TDDAgent {
  constructor(private readonly cwd = process.cwd()) {}

  generateTests(spec: TDDSpec): string {
    const normalized = normalizeSpec(spec);
    const files = this.planFiles(normalized);
    const framework = this.detectFramework();
    const importPath = toImportPath(files.testFile, files.sourceFile);
    const specLiteral = JSON.stringify(normalized, null, 2);
    const suiteName = `${files.slug} tdd cycle`;

    if (framework === 'jest') {
      return [
        "import { describe, it, expect } from '@jest/globals';",
        `import { buildArtifact } from '${importPath}';`,
        '',
        `const spec = ${specLiteral} as const;`,
        '',
        `describe('${suiteName}', () => {`,
        "  it('captures the original description', () => {",
        '    expect(buildArtifact().description).toBe(spec.description);',
        '  });',
        '',
        "  it('retains sample inputs', () => {",
        '    expect(buildArtifact().inputExamples).toEqual(spec.inputExamples ?? []);',
        '  });',
        '',
        '  for (const behavior of spec.expectedBehaviors) {',
        "    it(`tracks behavior: ${behavior}`, () => {",
        '      expect(buildArtifact().expectedBehaviors).toContain(behavior);',
        '    });',
        '  }',
        '});',
        '',
        renderSpecComment(normalized),
      ].join('\n');
    }

    if (framework === 'mocha') {
      return [
        "import assert from 'node:assert/strict';",
        "import { describe, it } from 'mocha';",
        `import { buildArtifact } from '${importPath}';`,
        '',
        `const spec = ${specLiteral} as const;`,
        '',
        `describe('${suiteName}', () => {`,
        "  it('captures the original description', () => {",
        '    assert.equal(buildArtifact().description, spec.description);',
        '  });',
        '',
        "  it('retains sample inputs', () => {",
        '    assert.deepEqual(buildArtifact().inputExamples, spec.inputExamples ?? []);',
        '  });',
        '',
        '  for (const behavior of spec.expectedBehaviors) {',
        "    it(`tracks behavior: ${behavior}`, () => {",
        '      assert.equal(buildArtifact().expectedBehaviors.includes(behavior), true);',
        '    });',
        '  }',
        '});',
        '',
        renderSpecComment(normalized),
      ].join('\n');
    }

    return [
      "import { describe, it, expect } from 'vitest';",
      `import { buildArtifact } from '${importPath}';`,
      '',
      `const spec = ${specLiteral} as const;`,
      '',
      `describe('${suiteName}', () => {`,
      "  it('captures the original description', () => {",
      '    expect(buildArtifact().description).toBe(spec.description);',
      '  });',
      '',
      "  it('retains sample inputs', () => {",
      '    expect(buildArtifact().inputExamples).toEqual(spec.inputExamples ?? []);',
      '  });',
      '',
      '  for (const behavior of spec.expectedBehaviors) {',
      "    it(`tracks behavior: ${behavior}`, () => {",
      '      expect(buildArtifact().expectedBehaviors).toContain(behavior);',
      '    });',
      '  }',
      '});',
      '',
      renderSpecComment(normalized),
    ].join('\n');
  }

  implement(testFile: string): string {
    const spec = this.readEmbeddedSpec(testFile);
    const specLiteral = JSON.stringify(spec, null, 2);
    return [
      'export interface GeneratedTDDArtifact {',
      '  description: string;',
      '  inputExamples: string[];',
      '  expectedBehaviors: string[];',
      '}',
      '',
      `const artifact = ${specLiteral} as const;`,
      '',
      'export function buildArtifact(): GeneratedTDDArtifact {',
      '  return {',
      '    description: artifact.description,',
      '    inputExamples: [...(artifact.inputExamples ?? [])],',
      '    expectedBehaviors: [...artifact.expectedBehaviors],',
      '  };',
      '}',
      '',
      'export default buildArtifact;',
      '',
    ].join('\n');
  }

  runTests(testFile: string): TestRunResult {
    const framework = FRAMEWORKS[this.detectFramework()];
    const result = spawnSync('npx', framework.argsForFile(testFile, this.cwd), {
      cwd: this.cwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const passed = lastNumberMatch(output, /\b(\d+)\s+passed\b/gi);
    const failed = lastNumberMatch(output, /\b(\d+)\s+failed\b/gi);
    const total =
      lastNumberMatch(output, /\b(\d+)\s+total\b/gi) ||
      lastNumberMatch(output, /Tests?\s+.*\((\d+)\)/gi) ||
      passed + failed;

    return {
      passed: passed || (result.status === 0 ? total : 0),
      failed: failed || (result.status === 0 ? 0 : total > 0 ? Math.max(total - passed, 1) : 1),
      total: total || passed + failed || (result.status === 0 ? 1 : 1),
      output,
    };
  }

  refactor(src: string, _test: string): string {
    return `${src
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()}\n`;
  }

  fullCycle(spec: TDDSpec): TDDResult {
    const normalized = normalizeSpec(spec);
    const files = this.planFiles(normalized);

    fs.mkdirSync(path.dirname(files.testFile), { recursive: true });
    fs.mkdirSync(path.dirname(files.sourceFile), { recursive: true });

    const testSource = this.generateTests(normalized);
    fs.writeFileSync(files.testFile, testSource, 'utf8');

    let cycles = 1;
    const firstRun = this.runTests(files.testFile);

    if (firstRun.failed > 0 || !fs.existsSync(files.sourceFile)) {
      fs.writeFileSync(files.sourceFile, this.implement(files.testFile), 'utf8');
      cycles += 1;
    }

    let finalRun = this.runTests(files.testFile);
    if (finalRun.failed > 0) {
      const currentSource = fs.readFileSync(files.sourceFile, 'utf8');
      fs.writeFileSync(files.sourceFile, this.refactor(currentSource, testSource), 'utf8');
      cycles += 1;
      finalRun = this.runTests(files.testFile);
    }

    return {
      spec: normalized,
      testFile: files.testFile,
      sourceFile: files.sourceFile,
      cycles,
      finalStatus: finalRun.failed === 0 ? 'green' : 'red',
    };
  }

  private detectFramework(): SupportedFramework {
    const pkg = this.readPackageJson();
    const testScript = String(pkg?.scripts?.test ?? '').toLowerCase();
    if (testScript.includes('vitest') || this.hasConfigPrefix('vitest.config.')) return 'vitest';
    if (testScript.includes('jest') || this.hasConfigPrefix('jest.config.')) return 'jest';
    if (testScript.includes('mocha') || this.hasDependency(pkg, 'mocha')) return 'mocha';
    if (this.hasDependency(pkg, 'vitest')) return 'vitest';
    if (this.hasDependency(pkg, 'jest')) return 'jest';
    return 'vitest';
  }

  private planFiles(spec: TDDSpec): PlannedFiles {
    const slug = slugify(spec.description) || 'tdd-cycle';
    return {
      slug,
      testFile: path.join(this.cwd, 'tests', 'tdd', `${slug}.test.ts`),
      sourceFile: path.join(this.cwd, 'src', 'tdd', `${slug}.ts`),
    };
  }

  private readEmbeddedSpec(testFile: string): TDDSpec {
    const testSource = fs.readFileSync(testFile, 'utf8');
    const match = /\/\*\s*TDD_SPEC\s*([\s\S]*?)\*\//.exec(testSource);
    if (!match?.[1]) {
      throw new Error(`Missing embedded TDD spec in ${testFile}`);
    }
    return normalizeSpec(JSON.parse(match[1]) as TDDSpec);
  }

  private readPackageJson(): PackageJson | undefined {
    const packagePath = path.join(this.cwd, 'package.json');
    if (!fs.existsSync(packagePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(packagePath, 'utf8')) as PackageJson;
    } catch {
      return undefined;
    }
  }

  private hasDependency(pkg: PackageJson | undefined, name: string): boolean {
    return Boolean(pkg?.devDependencies?.[name] ?? pkg?.dependencies?.[name]);
  }

  private hasConfigPrefix(prefix: string): boolean {
    try {
      return fs.readdirSync(this.cwd).some((entry) => entry.startsWith(prefix));
    } catch {
      return false;
    }
  }
}

function normalizeSpec(spec: TDDSpec): TDDSpec {
  const description = spec.description.trim();
  const inputExamples = [...new Set((spec.inputExamples ?? []).map((item) => item.trim()).filter(Boolean))];
  const expectedBehaviors = [
    ...new Set(spec.expectedBehaviors.map((item) => item.trim()).filter(Boolean)),
  ];
  return {
    description,
    ...(inputExamples.length > 0 ? { inputExamples } : {}),
    expectedBehaviors:
      expectedBehaviors.length > 0 ? expectedBehaviors : ['captures the original description'],
  };
}

function renderSpecComment(spec: TDDSpec): string {
  return `/* TDD_SPEC\n${JSON.stringify(spec, null, 2)}\n*/`;
}

function toImportPath(fromFile: string, targetFile: string): string {
  const relative = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, '/');
  const prefixed = relative.startsWith('.') ? relative : `./${relative}`;
  return prefixed.replace(/\.(?:ts|tsx|js|jsx)$/i, '.js');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function lastNumberMatch(text: string, pattern: RegExp): number {
  let match: RegExpExecArray | null = null;
  let last = 0;
  while ((match = pattern.exec(text)) !== null) {
    last = Number(match[1] ?? 0);
  }
  return Number.isFinite(last) ? last : 0;
}
