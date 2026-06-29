export interface AgentRoute {
  pattern: RegExp | string[];
  agentType: string;
  confidence: number;
}

const DEFAULT_THRESHOLD = 0.7;
const KEYWORD_BOOST = 0.12;
const QUESTION_BOOST = 0.16;
const STARTS_WITH_BOOST = 0.08;

const DEFAULT_ROUTES: AgentRoute[] = [
  {
    pattern: ['review', 'code review', 'audit', 'inspect'],
    agentType: 'review',
    confidence: 0.5,
  },
  {
    pattern: ['explain', 'how', 'why', 'what does'],
    agentType: 'explain',
    confidence: 0.48,
  },
  {
    pattern: ['fix', 'error', 'bug', 'broken', 'failing', 'debug'],
    agentType: 'fix',
    confidence: 0.52,
  },
  {
    pattern: ['refactor', 'improve', 'cleanup', 'clean up', 'optimize', 'simplify'],
    agentType: 'refactor',
    confidence: 0.5,
  },
  {
    pattern: ['test', 'tests', 'spec', 'specs'],
    agentType: 'test',
    confidence: 0.5,
  },
  {
    pattern: ['explore', 'find', 'where', 'locate', 'search'],
    agentType: 'explore',
    confidence: 0.48,
  },
  {
    pattern: ['plan', 'design', 'architect', 'architecture', 'approach'],
    agentType: 'plan',
    confidence: 0.5,
  },
];

const QUESTION_PATTERNS: Record<string, RegExp[]> = {
  review: [/\breview\b/, /\baudit\b/, /\binspect\b/],
  explain: [/^(?:can you\s+)?(?:explain|how|why)\b/, /\bwhat does\b/, /\bhow does\b/],
  fix: [/^(?:please\s+)?(?:fix|debug)\b/, /\b(?:error|bug|broken|failing)\b/],
  refactor: [/^(?:please\s+)?(?:refactor|improve)\b/, /\bclean up\b/, /\boptimi[sz]e\b/],
  test: [/^(?:add|write|create)?\s*tests?\b/, /\bspecs?\b/, /\btest\b/],
  explore: [/^(?:where|find|locate|explore)\b/, /\bwhere is\b/, /\bfind\b/],
  plan: [/^(?:plan|design|architect)\b/, /\barchitecture\b/, /\bhow should we\b/],
};

const STARTS_WITH_PATTERNS: Record<string, RegExp[]> = {
  review: [/^(?:please\s+)?review\b/],
  explain: [/^(?:can you\s+)?(?:explain|how|why)\b/],
  fix: [/^(?:please\s+)?(?:fix|debug)\b/],
  refactor: [/^(?:please\s+)?(?:refactor|improve)\b/],
  test: [/^(?:please\s+)?(?:test|spec|add tests?|write tests?)\b/],
  explore: [/^(?:please\s+)?(?:explore|find|where|locate)\b/],
  plan: [/^(?:please\s+)?(?:plan|design|architect)\b/],
};

const customRoutes: AgentRoute[] = [];
let threshold = readThreshold(process.env.ICOPILOT_AGENT_ROUTE_THRESHOLD);

export function routeQuery(query: string): { agent: string; confidence: number } | null {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return null;
  }

  let bestMatch: { agent: string; confidence: number } | null = null;

  for (const route of [...customRoutes, ...DEFAULT_ROUTES]) {
    const score = scoreRoute(route, normalizedQuery);
    if (!score) {
      continue;
    }

    if (!bestMatch || score > bestMatch.confidence) {
      bestMatch = { agent: route.agentType, confidence: score };
    }
  }

  if (!bestMatch || bestMatch.confidence < threshold) {
    return null;
  }

  return bestMatch;
}

export function addRoute(route: AgentRoute): void {
  customRoutes.unshift({
    ...route,
    confidence: clampConfidence(route.confidence),
  });
}

export function setRouteThreshold(nextThreshold: number): void {
  threshold = clampConfidence(nextThreshold);
}

export function getRouteThreshold(): number {
  return threshold;
}

function scoreRoute(route: AgentRoute, normalizedQuery: string): number {
  const keywordMatches = countMatches(route.pattern, normalizedQuery);
  if (keywordMatches === 0) {
    return 0;
  }

  let score = clampConfidence(route.confidence);
  score += Math.min(0.24, keywordMatches * KEYWORD_BOOST);
  score += Math.min(
    0.24,
    countSignalMatches(route.agentType, normalizedQuery, QUESTION_PATTERNS) * QUESTION_BOOST,
  );

  if (hasStartsWithSignal(route.agentType, normalizedQuery)) {
    score += STARTS_WITH_BOOST;
  }

  return roundConfidence(score);
}

function countMatches(pattern: RegExp | string[], normalizedQuery: string): number {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    return [...normalizedQuery.matchAll(matcher)].length;
  }

  return pattern.reduce(
    (count, keyword) => count + (hasKeywordMatch(keyword, normalizedQuery) ? 1 : 0),
    0,
  );
}

function countSignalMatches(
  agentType: string,
  normalizedQuery: string,
  patternsByAgent: Record<string, RegExp[]>,
): number {
  return (patternsByAgent[agentType] ?? []).reduce(
    (count, pattern) => count + (pattern.test(normalizedQuery) ? 1 : 0),
    0,
  );
}

function hasStartsWithSignal(agentType: string, normalizedQuery: string): boolean {
  return (STARTS_WITH_PATTERNS[agentType] ?? []).some((pattern) => pattern.test(normalizedQuery));
}

function hasKeywordMatch(keyword: string, normalizedQuery: string): boolean {
  const escapedKeyword = escapeRegExp(keyword.toLowerCase());
  const keywordPattern = new RegExp(`(?:^|\\b)${escapedKeyword}(?=\\b|$)`);
  return keywordPattern.test(normalizedQuery);
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readThreshold(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampConfidence(parsed) : DEFAULT_THRESHOLD;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THRESHOLD;
  }

  return Math.min(1, Math.max(0, value));
}

function roundConfidence(value: number): number {
  return Math.round(clampConfidence(value) * 100) / 100;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
