import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TDDAgent, type TDDSpec } from '../../src/agents/tdd-agent.js';

describe('TDDAgent', { timeout: 180_000 }, () => {
  let tmpRoot: string;
  let tmpDir: string;

  function writeProject(
    framework: 'vitest' | 'jest' | 'mocha',
    extras: Record<string, unknown> = {},
  ): void {
    const devDependencies: Record<string, string> = {};
    if (framework === 'vitest') devDependencies.vitest = '^1.6.0';
    if (framework === 'jest') devDependencies.jest = '^29.7.0';
    if (framework === 'mocha') devDependencies.mocha = '^10.7.0';

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'tdd-agent-fixture',
          private: true,
          type: 'module',
          devDependencies,
          ...extras,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

    if (framework === 'vitest') {
      fs.writeFileSync(
        path.join(tmpDir, 'vitest.config.ts'),
        'import { defineConfig } from "vitest/config";\nexport default defineConfig({});\n',
        'utf8',
      );
    }

    if (framework === 'jest') {
      fs.writeFileSync(
        path.join(tmpDir, 'jest.config.cjs'),
        'module.exports = { testEnvironment: "node" };\n',
        'utf8',
      );
    }
  }

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-tdd-agent-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('generates vitest tests when vitest is detected', () => {
    writeProject('vitest');
    const agent = new TDDAgent(tmpDir);
    const spec: TDDSpec = {
      description: 'Build a release note summarizer',
      inputExamples: ['feat: add /release'],
      expectedBehaviors: ['captures the original description', 'tracks expected behaviors'],
    };

    const testSource = agent.generateTests(spec);

    expect(testSource).toContain("from 'vitest'");
    expect(testSource).toContain('Build a release note summarizer');
    expect(testSource).toContain('feat: add /release');
    expect(testSource).toContain('tracks expected behaviors');
    expect(testSource).toContain('TDD_SPEC');
  });

  it('switches generated test style for jest and mocha detection', () => {
    writeProject('jest');
    const jestSource = new TDDAgent(tmpDir).generateTests({
      description: 'Validate jest output',
      expectedBehaviors: ['uses jest globals'],
    });
    expect(jestSource).toContain("from '@jest/globals'");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    writeProject('mocha');

    const mochaSource = new TDDAgent(tmpDir).generateTests({
      description: 'Validate mocha output',
      expectedBehaviors: ['uses assert helpers'],
    });

    expect(mochaSource).toContain("from 'mocha'");
    expect(mochaSource).toContain("from 'node:assert/strict'");
  });

  it('implements, runs, and records a full green cycle for vitest', () => {
    writeProject('vitest');
    const agent = new TDDAgent(tmpDir);
    const result = agent.fullCycle({
      description: 'Summarize slash command history',
      inputExamples: ['/help', '/tdd status'],
      expectedBehaviors: [
        'captures the original description',
        'preserves every expected behavior',
        'retains sample inputs',
      ],
    });

    expect(result.finalStatus).toBe('green');
    expect(result.cycles).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(result.testFile)).toBe(true);
    expect(fs.existsSync(result.sourceFile)).toBe(true);

    const testRun = agent.runTests(result.testFile);
    expect(testRun.failed).toBe(0);
    expect(testRun.passed).toBeGreaterThan(0);
    expect(testRun.total).toBeGreaterThan(0);
  });

  it('infers an implementation from the generated test file', () => {
    writeProject('vitest');
    const agent = new TDDAgent(tmpDir);
    const spec: TDDSpec = {
      description: 'Generate an artifact from the spec',
      expectedBehaviors: ['stores all behaviors'],
    };
    const testFile = path.join(
      tmpDir,
      'tests',
      'tdd',
      'generate-an-artifact-from-the-spec.test.ts',
    );
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, agent.generateTests(spec), 'utf8');

    const source = agent.implement(testFile);

    expect(source).toContain('buildArtifact');
    expect(source).toContain('Generate an artifact from the spec');
    expect(source).toContain('stores all behaviors');
  });

  it('refactors implementation output into a stable format', () => {
    writeProject('vitest');
    const agent = new TDDAgent(tmpDir);

    const refactored = agent.refactor(
      'export const value = 1;   \n\n\n',
      'describe("x", () => {})',
    );

    expect(refactored).toBe('export const value = 1;\n');
  });
});
