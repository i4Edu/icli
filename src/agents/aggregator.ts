export interface AgentResult {
  name: string;
  output: string;
  confidence?: number;
  tokens?: number;
}

export interface AggregatedOutput {
  summary: string;
  details: string[];
  conflicts: string[];
  sources: string[];
}

interface CandidatePoint {
  original: string;
  normalized: string;
  subject: string;
}

interface SourceDetail {
  result: AgentResult;
  points: CandidatePoint[];
}

const NEGATIVE_PATTERNS = [
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bnot\b/i,
  /\bnever\b/i,
  /\bavoid\b/i,
  /\bskip\b/i,
  /\bdisable\b/i,
  /\bremove\b/i,
  /\breject\b/i,
];

const CONFLICTING_PHRASES: Array<[RegExp, RegExp]> = [
  [/\benable\b/i, /\bdisable\b/i],
  [/\badd\b/i, /\bremove\b/i],
  [/\buse\b/i, /\bavoid\b/i],
  [/\balways\b/i, /\bnever\b/i],
  [/\binclude\b/i, /\bexclude\b/i],
  [/\bsync\b/i, /\basync\b/i],
];

export function aggregateResults(results: AgentResult[]): AggregatedOutput {
  const sources = unique(results.map((result) => result.name.trim()).filter(Boolean));

  if (results.length === 0) {
    return {
      summary: ['## Summary', '- No agent results available.'].join('\n'),
      details: [],
      conflicts: [],
      sources,
    };
  }

  const details = results.map<SourceDetail>((result) => ({
    result,
    points: extractPoints(result.output),
  }));

  const pointIndex = new Map<
    string,
    {
      point: CandidatePoint;
      mentions: number;
      sources: string[];
      confidence: number;
    }
  >();

  for (const detail of details) {
    for (const point of detail.points) {
      const existing = pointIndex.get(point.normalized);
      if (existing) {
        existing.mentions += 1;
        existing.confidence = Math.max(existing.confidence, detail.result.confidence ?? 0);
        if (!existing.sources.includes(detail.result.name)) {
          existing.sources.push(detail.result.name);
        }
        continue;
      }

      pointIndex.set(point.normalized, {
        point,
        mentions: 1,
        sources: [detail.result.name],
        confidence: detail.result.confidence ?? 0,
      });
    }
  }

  const uniquePoints = [...pointIndex.values()].sort(
    (left, right) =>
      right.mentions - left.mentions ||
      right.confidence - left.confidence ||
      right.point.original.length - left.point.original.length,
  );

  const summaryLines = uniquePoints.slice(0, 5).map(({ point, sources: pointSources }) => {
    const suffix = pointSources.length > 1 ? ` _(sources: ${pointSources.join(', ')})_` : '';
    return `- ${point.original}${suffix}`;
  });

  const conflictMessages = detectConflicts(details);

  return {
    summary: [
      '## Summary',
      ...(summaryLines.length > 0 ? summaryLines : ['- No shared recommendations found.']),
    ].join('\n'),
    details: details.map((detail) => formatDetailSection(detail)),
    conflicts: conflictMessages,
    sources,
  };
}

function formatDetailSection(detail: SourceDetail): string {
  const metadata: string[] = [];
  if (typeof detail.result.confidence === 'number') {
    metadata.push(`confidence: ${formatConfidence(detail.result.confidence)}`);
  }
  if (typeof detail.result.tokens === 'number') {
    metadata.push(`tokens: ${detail.result.tokens}`);
  }

  const header = `### ${detail.result.name}`;
  const meta = metadata.length > 0 ? `${metadata.join(' • ')}` : undefined;
  const lines =
    detail.points.length > 0
      ? detail.points.map((point) => `- ${point.original}`)
      : ['- No actionable points extracted.'];

  return [header, meta, ...lines].filter((line): line is string => Boolean(line)).join('\n');
}

function detectConflicts(details: SourceDetail[]): string[] {
  const conflicts = new Set<string>();

  for (let index = 0; index < details.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < details.length; compareIndex += 1) {
      const left = details[index];
      const right = details[compareIndex];

      for (const leftPoint of left.points) {
        for (const rightPoint of right.points) {
          if (leftPoint.normalized === rightPoint.normalized) continue;
          if (leftPoint.subject !== rightPoint.subject) continue;
          if (!isConflict(leftPoint.original, rightPoint.original)) continue;

          conflicts.add(
            `- Conflict between **${left.result.name}** and **${right.result.name}** on _${leftPoint.subject}_: "${leftPoint.original}" vs "${rightPoint.original}"`,
          );
        }
      }
    }
  }

  return [...conflicts];
}

function isConflict(left: string, right: string): boolean {
  const leftNegative = hasNegativeIntent(left);
  const rightNegative = hasNegativeIntent(right);

  if (leftNegative !== rightNegative) {
    return true;
  }

  return CONFLICTING_PHRASES.some(
    ([first, second]) =>
      (first.test(left) && second.test(right)) || (second.test(left) && first.test(right)),
  );
}

function hasNegativeIntent(value: string): boolean {
  return NEGATIVE_PATTERNS.some((pattern) => pattern.test(value));
}

function extractPoints(output: string): CandidatePoint[] {
  const segments = output
    .split(/\r?\n+/)
    .flatMap((line) => splitLineIntoPoints(line))
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const points: CandidatePoint[] = [];

  for (const segment of segments) {
    const original = cleanupSegment(segment);
    if (!original) continue;

    const normalized = normalizePoint(original);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    points.push({
      original,
      normalized,
      subject: deriveSubject(normalized),
    });
  }

  return points;
}

function splitLineIntoPoints(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
    return [trimmed.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')];
  }

  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cleanupSegment(value: string): string {
  return value
    .replace(/^#+\s*/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePoint(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveSubject(normalized: string): string {
  const withoutLeadVerb = normalized.replace(
    /^(?:use|avoid|enable|disable|add|remove|include|exclude|always|never|do not|don t|not|skip)\s+/,
    '',
  );

  return withoutLeadVerb
    .split(' ')
    .filter((token) => token.length > 2)
    .slice(0, 6)
    .join(' ')
    .trim();
}

function formatConfidence(confidence: number): string {
  if (confidence >= 0 && confidence <= 1) {
    return `${Math.round(confidence * 100)}%`;
  }

  return `${confidence}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
