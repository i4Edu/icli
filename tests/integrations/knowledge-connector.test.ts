import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KnowledgeConnector,
  loadKnowledgeSources,
} from '../../src/integrations/knowledge-connector.js';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

describe('KnowledgeConnector', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('ingests documents and ranks search results', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [
          {
            id: '1',
            title: 'Deploy guide',
            content: 'How to deploy integration hub v2.5',
            lastUpdated: 10,
          },
          { id: '2', title: 'Runbook', content: 'Rollback integration hub safely', lastUpdated: 5 },
        ],
      }),
    } as Response);

    const connector = new KnowledgeConnector();
    connector.addSource({
      id: 'docs',
      name: 'Docs',
      type: 'docsite',
      baseUrl: 'https://docs.example.com/index.json',
    });

    await connector.ingest('docs');
    const results = await connector.search({ query: 'deploy integration', maxResults: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ id: '1', source: 'docs' }));
    expect(connector.formatResults(results)).toContain('Deploy guide');
  });

  it('removes sources and their indexed documents', async () => {
    const connector = new KnowledgeConnector();
    connector.addSource({
      id: 'kb',
      name: 'KB',
      type: 'custom',
      baseUrl: 'https://kb.example.com',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'doc-1', title: 'Doc', content: 'useful text', lastUpdated: 4 }],
    } as Response);

    await connector.ingest('kb');
    expect(connector.getIndex()).toHaveLength(1);
    expect(connector.removeSource('kb')).toBe(true);
    expect(connector.getIndex()).toHaveLength(0);
  });

  it('loads knowledge source configuration from disk', () => {
    const root = path.join(process.cwd(), '.vitest-knowledge');
    fs.mkdirSync(path.join(root, '.icopilot'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.icopilot', 'knowledge-sources.json'),
      JSON.stringify([
        { id: 'docs', name: 'Docs', type: 'notion', baseUrl: 'https://notion.example.com' },
      ]),
      'utf8',
    );

    expect(loadKnowledgeSources(root)).toEqual([
      {
        id: 'docs',
        name: 'Docs',
        type: 'notion',
        baseUrl: 'https://notion.example.com',
        auth: undefined,
      },
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
