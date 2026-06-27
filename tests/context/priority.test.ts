import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildContextWindow,
  type ContextSource,
  PriorityScorer,
} from '../../src/context/priority.js';

let tmpDir: string;

beforeEach(() => {
  const baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'priority-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PriorityScorer', () => {
  it('scores and ranks sources by configured relevance factors', () => {
    const scorer = new PriorityScorer();
    const sources: ContextSource[] = [
      {
        id: 'src/context/priority.ts',
        type: 'pinned',
        content: 'priority scorer buildContextWindow selectWithinBudget',
        tokens: 120,
        metadata: {
          recentlyMentioned: true,
          keywords: ['priority', 'context'],
          dependencyDistance: 1,
        },
      },
      {
        id: 'team-memory',
        type: 'team',
        content: 'Use the priority scorer for context ranking.',
        tokens: 80,
      },
      {
        id: 'git-diff',
        type: 'git',
        content: 'priority.ts was modified to support ranking',
        tokens: 90,
      },
      {
        id: 'history-turn',
        type: 'history',
        content: 'We discussed context ranking yesterday',
        tokens: 500,
      },
    ];

    const scored = scorer.score(sources, 'priority context ranking');

    expect(scored.map((source) => source.id)).toEqual([
      'src/context/priority.ts',
      'git-diff',
      'team-memory',
      'history-turn',
    ]);

    expect(scored[0].score).toBe(215);
    expect(scored[0].reasons).toEqual([
      'pinned source',
      'recently mentioned in conversation',
      'query keyword overlap',
      'small source bonus',
      'dependency proximity',
    ]);

    expect(scored[1].score).toBe(60);
    expect(scored[1].reasons).toContain('recently modified');
    expect(scored[1].reasons).toContain('query keyword overlap');

    expect(scored[2].score).toBe(55);
    expect(scored[2].reasons).toContain('team memory');
  });

  it('greedily selects high-score sources within budget while always keeping pinned items', () => {
    const scorer = new PriorityScorer();
    const scored = scorer.score(
      [
        {
          id: 'pinned-large',
          type: 'pinned',
          content: 'critical context',
          tokens: 160,
        },
        {
          id: 'small-match',
          type: 'file',
          content: 'critical context selector',
          tokens: 40,
        },
        {
          id: 'large-match',
          type: 'file',
          content: 'critical context selector large',
          tokens: 90,
        },
      ],
      'critical context selector',
    );

    const selected = scorer.selectWithinBudget(scored, 200);

    expect(selected.map((source) => source.id)).toEqual(['pinned-large', 'small-match']);
    expect(selected[0].tokens + selected[1].tokens).toBe(200);
  });

  it('builds a final context window from selected sources', () => {
    const notesPath = path.join(tmpDir, 'notes.txt');
    fs.writeFileSync(notesPath, 'deploy notes\n');

    const sources: ContextSource[] = [
      {
        id: notesPath,
        type: 'pinned',
        content: fs.readFileSync(notesPath, 'utf8'),
        tokens: 40,
      },
      {
        id: 'memory',
        type: 'memory',
        content: 'Remember the deployment checklist and release steps.',
        tokens: 55,
        metadata: {
          recentlyMentioned: true,
          keywords: ['deployment', 'checklist'],
        },
      },
      {
        id: 'history',
        type: 'history',
        content: 'Old unrelated conversation',
        tokens: 500,
      },
    ];
    const window = buildContextWindow(sources, 'deployment checklist', 120);

    expect(window).toContain(`### [pinned] ${notesPath}`);
    expect(window).toContain('reasons: pinned source, small source bonus');
    expect(window).toContain('### [memory] memory');
    expect(window).toContain('deploy notes');
    expect(window).toContain('Remember the deployment checklist and release steps.');
    expect(window).not.toContain('Old unrelated conversation');
  });
});
