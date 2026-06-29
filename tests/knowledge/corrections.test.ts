import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorrectionMemory, loadCorrectionPromptContext } from '../../src/knowledge/corrections.js';

let tmpRoot: string;
let tmpDir: string;
let storePath: string;
let originalCorrectionsPath: string | undefined;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-corrections-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  storePath = path.join(tmpDir, 'corrections.json');
  originalCorrectionsPath = process.env.ICOPILOT_CORRECTIONS_PATH;
  process.env.ICOPILOT_CORRECTIONS_PATH = storePath;
});

afterEach(() => {
  if (originalCorrectionsPath === undefined) {
    delete process.env.ICOPILOT_CORRECTIONS_PATH;
  } else {
    process.env.ICOPILOT_CORRECTIONS_PATH = originalCorrectionsPath;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('CorrectionMemory', () => {
  it('stores corrections, deduplicates repeats, and formats prompt context', () => {
    const memory = new CorrectionMemory(storePath);

    memory.add({
      pattern: 'typescript formatting',
      wrongBehavior: 'omit semicolons in TypeScript files',
      correctBehavior: 'always include semicolons in TypeScript files',
      category: 'style',
    });
    memory.add({
      pattern: 'typescript formatting',
      wrongBehavior: 'omit semicolons in TypeScript files',
      correctBehavior: 'always include semicolons in TypeScript files',
      category: 'style',
    });

    const [entry] = memory.list();
    expect(memory.list()).toHaveLength(1);
    expect(entry.frequency).toBe(2);

    memory.incrementFrequency(entry.id);

    const [updated] = memory.search('semicolons');
    expect(updated.frequency).toBe(3);
    expect(updated.category).toBe('style');
    expect(memory.toPromptContext()).toContain('Do NOT omit semicolons in TypeScript files');
    expect(memory.toPromptContext()).toContain('always include semicolons in TypeScript files');
  });

  it('persists corrections and returns only relevant prompt context', () => {
    const memory = new CorrectionMemory(storePath);
    memory.add({
      pattern: 'slash commands',
      wrongBehavior: 'rename slash commands',
      correctBehavior: 'preserve the existing slash command names',
      category: 'cli',
    });
    memory.add({
      pattern: 'tests',
      wrongBehavior: 'skip targeted vitest coverage',
      correctBehavior: 'add or update focused vitest coverage for the change',
      category: 'quality',
    });
    memory.add({
      pattern: 'markdown',
      wrongBehavior: 'create planning markdown files in the repository',
      correctBehavior: 'keep planning in memory unless a markdown file is explicitly requested',
      category: 'workflow',
    });
    memory.save();

    const reloaded = new CorrectionMemory(storePath);
    reloaded.load();

    const relevant = reloaded.getRelevant('Update slash commands and tests for the CLI');
    expect(relevant.map((entry) => entry.pattern)).toContain('slash commands');
    expect(relevant.map((entry) => entry.pattern)).toContain('tests');
    expect(relevant.map((entry) => entry.pattern)).not.toContain('markdown');

    const prompt = loadCorrectionPromptContext('Need to update slash commands in the CLI');
    expect(prompt).toContain('Do NOT rename slash commands');
    expect(prompt).not.toContain('planning markdown files');

    const firstId = reloaded.list()[0]?.id;
    expect(firstId).toBeTruthy();
    reloaded.remove(firstId!);
    reloaded.save();

    const afterRemoval = new CorrectionMemory(storePath);
    afterRemoval.load();
    expect(afterRemoval.list()).toHaveLength(2);
  });
});
