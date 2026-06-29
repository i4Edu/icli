export interface ContextSource {
  id: string;
  type: 'file' | 'pinned' | 'memory' | 'git' | 'team' | 'history';
  content: string;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface ScoredSource extends ContextSource {
  score: number;
  reasons: string[];
}

const PINNED_BONUS = 100;
const RECENTLY_MENTIONED_BONUS = 50;
const KEYWORD_OVERLAP_BONUS = 30;
const RECENTLY_MODIFIED_BONUS = 20;
const SMALL_FILE_BONUS = 10;
const TEAM_MEMORY_BONUS = 15;
const DEPENDENCY_PROXIMITY_BONUS = 25;
const SMALL_SOURCE_TOKEN_LIMIT = 400;

export class PriorityScorer {
  score(sources: ContextSource[], query: string): ScoredSource[] {
    const queryKeywords = extractKeywords(query);

    return sources
      .map((source) => this.scoreSource(source, queryKeywords))
      .sort(compareScoredSources);
  }

  selectWithinBudget(scored: ScoredSource[], tokenBudget: number): ScoredSource[] {
    const selected: ScoredSource[] = [];
    let usedTokens = 0;

    for (const source of scored) {
      const pinned = isPinnedSource(source);
      const nextTokens = usedTokens + source.tokens;
      if (!pinned && nextTokens > tokenBudget) continue;
      selected.push(source);
      usedTokens = nextTokens;
    }

    return selected;
  }

  private scoreSource(source: ContextSource, queryKeywords: Set<string>): ScoredSource {
    let score = 0;
    const reasons: string[] = [];

    if (isPinnedSource(source)) {
      score += PINNED_BONUS;
      reasons.push('pinned source');
    }

    if (
      hasTruthyFlag(source.metadata, ['recentlyMentioned', 'mentionedRecently', 'recentMention'])
    ) {
      score += RECENTLY_MENTIONED_BONUS;
      reasons.push('recently mentioned in conversation');
    }

    if (hasKeywordOverlap(source, queryKeywords)) {
      score += KEYWORD_OVERLAP_BONUS;
      reasons.push('query keyword overlap');
    }

    if (isRecentlyModified(source)) {
      score += RECENTLY_MODIFIED_BONUS;
      reasons.push('recently modified');
    }

    if (source.tokens > 0 && source.tokens <= SMALL_SOURCE_TOKEN_LIMIT) {
      score += SMALL_FILE_BONUS;
      reasons.push('small source bonus');
    }

    if (source.type === 'team') {
      score += TEAM_MEMORY_BONUS;
      reasons.push('team memory');
    }

    if (hasDependencyProximity(source.metadata)) {
      score += DEPENDENCY_PROXIMITY_BONUS;
      reasons.push('dependency proximity');
    }

    return {
      ...source,
      score,
      reasons,
    };
  }
}

export function buildContextWindow(
  sources: ContextSource[],
  query: string,
  budget: number,
): string {
  const scorer = new PriorityScorer();
  const scored = scorer.score(sources, query);
  const selected = scorer.selectWithinBudget(scored, budget);

  return selected
    .map((source) =>
      [
        `### [${source.type}] ${source.id}`,
        `score: ${source.score}`,
        `reasons: ${source.reasons.join(', ') || 'none'}`,
        source.content,
      ].join('\n'),
    )
    .join('\n\n');
}

function compareScoredSources(left: ScoredSource, right: ScoredSource): number {
  return right.score - left.score || left.tokens - right.tokens || left.id.localeCompare(right.id);
}

function isPinnedSource(source: ContextSource): boolean {
  return source.type === 'pinned' || hasTruthyFlag(source.metadata, ['pinned', 'alwaysInclude']);
}

function isRecentlyModified(source: ContextSource): boolean {
  if (source.type === 'git') return true;

  return (
    hasTruthyFlag(source.metadata, ['recentlyModified', 'gitModified']) ||
    isFreshTimestamp(source.metadata?.updatedAt)
  );
}

function hasKeywordOverlap(source: ContextSource, queryKeywords: Set<string>): boolean {
  if (queryKeywords.size === 0) return false;
  const sourceKeywords = extractKeywords(
    [
      source.id,
      source.content,
      ...collectTextMetadata(source.metadata),
      ...collectKeywordMetadata(source.metadata),
    ].join(' '),
  );

  for (const keyword of queryKeywords) {
    if (sourceKeywords.has(keyword)) return true;
  }

  return false;
}

function hasDependencyProximity(metadata: ContextSource['metadata']): boolean {
  if (!metadata) return false;

  if (hasTruthyFlag(metadata, ['dependencyProximity', 'nearDependency'])) return true;

  const distance = metadata.dependencyDistance;
  return (
    typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 && distance <= 2
  );
}

function hasTruthyFlag(metadata: ContextSource['metadata'], keys: string[]): boolean {
  if (!metadata) return false;
  return keys.some((key) => Boolean(metadata[key]));
}

function isFreshTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  );
}

function collectTextMetadata(metadata: ContextSource['metadata']): string[] {
  if (!metadata) return [];
  const values: string[] = [];

  for (const key of ['path', 'title', 'summary', 'module', 'dependency']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) values.push(value);
  }

  return values;
}

function collectKeywordMetadata(metadata: ContextSource['metadata']): string[] {
  if (!metadata || !Array.isArray(metadata.keywords)) return [];
  return metadata.keywords.filter((value): value is string => typeof value === 'string');
}
