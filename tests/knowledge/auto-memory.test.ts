import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutoMemory,
  extractMemories,
  learnAutoMemories,
  loadAutoMemoryPromptContext,
} from '../../src/knowledge/auto-memory.js';

let tmpRoot: string;
let tmpDir: string;
let storePath: string;
let originalAutoMemoryPath: string | undefined;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-auto-memory-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  storePath = path.join(tmpDir, 'auto-memory.json');
  originalAutoMemoryPath = process.env.ICOPILOT_AUTO_MEMORY_PATH;
  process.env.ICOPILOT_AUTO_MEMORY_PATH = storePath;
});

afterEach(() => {
  if (originalAutoMemoryPath === undefined) {
    delete process.env.ICOPILOT_AUTO_MEMORY_PATH;
  } else {
    process.env.ICOPILOT_AUTO_MEMORY_PATH = originalAutoMemoryPath;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('AutoMemory', () => {
  it('stores, reloads, ranks, and prunes learned memories', () => {
    const memory = new AutoMemory(storePath);
    const build = memory.addMemory('Project build command: npm run build.', 'discovery');
    const tests = memory.addMemory('Project test command: npx vitest run.', 'discovery');
    const style = memory.addMemory('User preference: always use tabs.', 'preference');

    expect(build?.source).toBe('discovery');
    expect(style?.confidence).toBeGreaterThan(build?.confidence ?? 0);

    memory.save();

    const reloaded = new AutoMemory(storePath);
    reloaded.load();
    const relevant = reloaded.getRelevantMemories('Need to update build and test steps', 2);
    expect(relevant).toHaveLength(2);
    expect(relevant.map((entry) => entry.fact)).toContain('Project build command: npm run build.');
    expect(relevant.map((entry) => entry.fact)).toContain('Project test command: npx vitest run.');

    const prompt = loadAutoMemoryPromptContext('Please run the build command');
    expect(prompt).toContain('Auto-learned project memories');
    expect(prompt).toContain('Project build command: npm run build.');

    reloaded.memories.push({
      id: 'stale',
      fact: 'Old convention.',
      source: 'discovery',
      confidence: 0.5,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      lastUsedAt: new Date('2020-01-01T00:00:00.000Z'),
      usageCount: 1,
    });
    reloaded.prune(28);
    expect(reloaded.memories.some((entry) => entry.id === 'stale')).toBe(false);
    expect(tests).toBeTruthy();
  });

  it('extracts memorable facts and learns them automatically', () => {
    const facts = extractMemories(
      'Actually, use pnpm instead of npm. I prefer functional style and always use tabs.',
      'To validate changes, run `pnpm test` and `pnpm build`. The slash command handler lives in src/commands/slash.ts.',
    );

    expect(facts).toContain('Use pnpm instead of npm.');
    expect(facts).toContain('User preference: prefer functional style and always use tabs.');
    expect(facts).toContain('Project test command: pnpm test.');
    expect(facts).toContain('Project build command: pnpm build.');
    expect(facts.some((fact) => fact.includes('src/commands/slash.ts'))).toBe(true);

    const learned = learnAutoMemories(
      'Actually, use pnpm instead of npm. Please use functional style.',
      'Run `pnpm test` before sending patches.',
    );

    expect(learned.length).toBeGreaterThanOrEqual(2);

    const reloaded = new AutoMemory(storePath);
    reloaded.load();
    expect(reloaded.memories.some((entry) => entry.fact === 'Use pnpm instead of npm.')).toBe(true);
    expect(
      reloaded.memories.some((entry) => entry.fact === 'User preference: use functional style.'),
    ).toBe(true);
    expect(
      reloaded.memories.some((entry) => entry.fact === 'Project test command: pnpm test.'),
    ).toBe(true);
  });
});
