import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RAGIndex, defaultRagIndexPath } from '../../src/knowledge/rag.js';

const tempDirs: string[] = [];

describe('RAGIndex', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('indexes project documents and persists the default index', async () => {
    const root = createProject();
    const index = new RAGIndex();

    await index.indexProject(root, {
      extensions: ['.md', '.ts'],
      maxChunkTokens: 120,
      overlap: 20,
    });

    const stats = index.getStats();
    expect(stats.documents).toBe(3);
    expect(stats.chunks).toBeGreaterThanOrEqual(3);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(fs.existsSync(defaultRagIndexPath(root))).toBe(true);

    const matches = index.search('deployment checklist', 2);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.metadata.file).toBe('README.md');
  });

  it('supports add, remove, save, and load', async () => {
    const root = createProject();
    const extraFile = path.join(root, 'notes.md');
    fs.writeFileSync(extraFile, '# Notes\n\nRAG caches retrieval answers for operators.\n', 'utf8');

    const index = new RAGIndex();
    await index.indexProject(root, {
      extensions: ['.md', '.ts'],
      maxChunkTokens: 120,
      overlap: 10,
    });

    index.addDocument(extraFile);
    expect(index.search('operators', 1)[0]?.metadata.file).toBe('notes.md');

    index.removeDocument(extraFile);
    expect(index.search('operators', 1)).toEqual([]);

    const savedPath = path.join(root, '.icopilot', 'rag-copy.json');
    index.save(savedPath);

    const loaded = new RAGIndex();
    loaded.load(savedPath);
    expect(loaded.getStats()).toEqual(index.getStats());
    expect(loaded.search('buildWidget', 1)[0]?.metadata.file).toBe('src/example.ts');
  });
});

function createProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-rag-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'README.md'),
    [
      '# Project docs',
      '',
      'The deployment checklist covers release validation, rollback notes, and smoke testing.',
      '',
      '## Retrieval',
      '',
      'Retrieval augmented generation should surface the deployment checklist quickly.',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'docs', 'guide.md'),
    [
      '# Guide',
      '',
      'Use the guide to explain chunk scoring and TF IDF ranking.',
      '',
      'Search quality improves when chunks preserve paragraph context.',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'example.ts'),
    [
      'export function buildWidget(name: string): string {',
      '  return `widget:${name}`;',
      '}',
      '',
      'export class WidgetPlanner {',
      '  createPlan(goal: string): string {',
      '    return `plan:${goal}`;',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  return root;
}
