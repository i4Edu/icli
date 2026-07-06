import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface KnowledgeSource {
  id: string;
  name: string;
  type: 'confluence' | 'notion' | 'docsite' | 'custom';
  baseUrl: string;
  auth?: Record<string, string>;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  lastUpdated: number;
  relevanceScore?: number;
}

export interface KnowledgeQuery {
  query: string;
  sources?: string[];
  maxResults?: number;
  filters?: Record<string, string>;
}

interface SearchableDocument extends KnowledgeDocument {
  normalizedTitle: string;
  normalizedContent: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function configPath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'knowledge-sources.json');
}

function normalizeSource(value: unknown): KnowledgeSource | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.baseUrl !== 'string' ||
    !['confluence', 'notion', 'docsite', 'custom'].includes(String(value.type))
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type as KnowledgeSource['type'],
    baseUrl: value.baseUrl,
    auth: isStringRecord(value.auth) ? { ...value.auth } : undefined,
  };
}

function normalizeDocument(value: unknown, sourceId: string): KnowledgeDocument | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    content: value.content,
    source: typeof value.source === 'string' ? value.source : sourceId,
    lastUpdated: typeof value.lastUpdated === 'number' ? value.lastUpdated : Date.now(),
    relevanceScore: typeof value.relevanceScore === 'number' ? value.relevanceScore : undefined,
  };
}

function scoreDocument(document: SearchableDocument, searchTerms: string[]): number {
  return searchTerms.reduce((score, term) => {
    const titleHits = document.normalizedTitle.split(term).length - 1;
    const contentHits = document.normalizedContent.split(term).length - 1;
    return score + titleHits * 3 + contentHits;
  }, 0);
}

export class KnowledgeConnector {
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly index = new Map<string, SearchableDocument>();

  addSource(source: KnowledgeSource): void {
    this.sources.set(source.id, { ...source, auth: source.auth ? { ...source.auth } : undefined });
  }

  removeSource(id: string): boolean {
    const removed = this.sources.delete(id);
    for (const [key, document] of this.index.entries()) {
      if (document.source === id) this.index.delete(key);
    }
    return removed;
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeDocument[]> {
    const searchTerms = query.query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const allowedSources = query.sources ? new Set(query.sources) : null;
    const matches = [...this.index.values()]
      .filter((document) => !allowedSources || allowedSources.has(document.source))
      .filter((document) => {
        if (!query.filters) return true;
        return Object.entries(query.filters).every(([key, value]) => {
          if (key === 'source') return document.source === value;
          return false;
        });
      })
      .map((document) => ({ document, score: scoreDocument(document, searchTerms) }))
      .filter((entry) => entry.score > 0 || searchTerms.length === 0)
      .sort(
        (left, right) =>
          right.score - left.score || right.document.lastUpdated - left.document.lastUpdated,
      )
      .slice(0, query.maxResults ?? 10)
      .map(({ document, score }) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        source: document.source,
        lastUpdated: document.lastUpdated,
        relevanceScore: score,
      }));
    return matches;
  }

  async ingest(sourceId: string): Promise<KnowledgeDocument[]> {
    const source = this.sources.get(sourceId);
    if (!source || typeof fetch !== 'function') return [];
    const response = await fetch(source.baseUrl, {
      headers: source.auth,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as unknown;
    const entries = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.documents)
        ? payload.documents
        : [];
    const documents = entries
      .map((entry) => normalizeDocument(entry, sourceId))
      .filter((document): document is KnowledgeDocument => document !== null);
    for (const document of documents) {
      this.index.set(document.id, {
        ...document,
        normalizedTitle: document.title.toLowerCase(),
        normalizedContent: document.content.toLowerCase(),
      });
    }
    return documents;
  }

  getIndex(): KnowledgeDocument[] {
    return [...this.index.values()].map(
      ({ normalizedTitle: _title, normalizedContent: _content, ...document }) => ({
        ...document,
      }),
    );
  }

  getSources(): KnowledgeSource[] {
    return [...this.sources.values()].map((source) => ({
      ...source,
      auth: source.auth ? { ...source.auth } : undefined,
    }));
  }

  formatResults(docs: KnowledgeDocument[]): string {
    if (!docs.length) return theme.hint('No knowledge results found.');
    return docs
      .map(
        (doc) =>
          `${theme.hl(doc.title)} ${theme.dim(`(${doc.source})`)}${
            doc.relevanceScore !== undefined ? ` ${theme.badge(String(doc.relevanceScore))}` : ''
          }\n${doc.content}`,
      )
      .join('\n\n');
  }
}

export function loadKnowledgeSources(cwd = config.cwd): KnowledgeSource[] {
  const filePath = configPath(cwd);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeSource(entry))
      .filter((source): source is KnowledgeSource => source !== null);
  } catch {
    return [];
  }
}
