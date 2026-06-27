import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMemoryBlock } from '../../src/context/memory.js';
import { TeamMemory } from '../../src/context/team-memory.js';

let baseDir: string;
let projectDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  projectDir = fs.mkdtempSync(path.join(baseDir, 'team-memory-project-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('TeamMemory', () => {
  it('adds, loads, lists, renders, and removes entries', () => {
    const memory = new TeamMemory();
    expect(memory.load(projectDir)).toEqual([]);

    memory.add({
      id: 'decision-use-vitest',
      category: 'decision',
      content: 'Use Vitest for CLI and context tests.',
      author: 'CLI Team',
      date: '2026-06-27',
    });
    memory.add({
      id: 'warning-keep-prompts-short',
      category: 'warning',
      content: 'Keep injected context concise to avoid token bloat.',
    });

    const restored = new TeamMemory();
    restored.load(projectDir);

    expect(restored.list()).toEqual([
      {
        id: 'decision-use-vitest',
        category: 'decision',
        content: 'Use Vitest for CLI and context tests.',
        author: 'CLI Team',
        date: '2026-06-27',
      },
      {
        id: 'warning-keep-prompts-short',
        category: 'warning',
        content: 'Keep injected context concise to avoid token bloat.',
        author: undefined,
        date: undefined,
      },
    ]);
    expect(restored.render()).toContain('## Team memory');
    expect(restored.render()).toContain('[decision • CLI Team • 2026-06-27]');
    expect(restored.render()).toContain('Keep injected context concise');

    restored.remove('decision-use-vitest');
    expect(restored.list().map((entry) => entry.id)).toEqual(['warning-keep-prompts-short']);
  });

  it('searches entries by metadata and content', () => {
    const memory = new TeamMemory();
    memory.load(projectDir);
    memory.add({
      id: 'convention-typescript-esm',
      category: 'convention',
      content: 'Prefer ESM imports in TypeScript files.',
      author: 'Maintainers',
    });
    memory.add({
      id: 'tip-fast-tests',
      category: 'tip',
      content: 'Run focused Vitest files before the full suite.',
    });

    expect(memory.search('vitest').map((entry) => entry.id)).toEqual(['tip-fast-tests']);
    expect(memory.search('maintainers').map((entry) => entry.id)).toEqual(['convention-typescript-esm']);
    expect(memory.search('convention').map((entry) => entry.id)).toEqual(['convention-typescript-esm']);
  });

  it('ignores malformed sections and injects team memory into the shared memory block', () => {
    const configDir = path.join(projectDir, '.icopilot');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'team-memory.md'),
      `# Team memory

## valid-entry
<!--
id: valid-entry
category: tip
author: Docs
date: 2026-06-27
-->
Document shared workflows in one place.

## invalid-entry
<!--
id: invalid-entry
category: nope
-->
This section should be ignored.
`,
      'utf8',
    );

    const memory = new TeamMemory();
    expect(memory.load(projectDir)).toEqual([
      {
        id: 'valid-entry',
        category: 'tip',
        content: 'Document shared workflows in one place.',
        author: 'Docs',
        date: '2026-06-27',
      },
    ]);

    const block = loadMemoryBlock(projectDir);
    expect(block).toContain('## Team memory');
    expect(block).toContain('Document shared workflows in one place.');
  });
});
