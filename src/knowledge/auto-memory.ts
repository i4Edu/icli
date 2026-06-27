import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type MemorySource = 'correction' | 'discovery' | 'preference';

export interface MemoryEntry {
  id: string;
  fact: string;
  source: MemorySource;
  confidence: number;
  createdAt: Date;
  lastUsedAt: Date;
  usageCount: number;
}

interface MemoryCandidate {
  fact: string;
  source: MemorySource;
}

const DEFAULT_PRUNE_AGE_DAYS = 28;
const DEFAULT_PROMPT_LIMIT = 12;
const MAX_FACT_LENGTH = 180;

export class AutoMemory {
  memories: MemoryEntry[] = [];

  constructor(private readonly storePath = resolveAutoMemoryPath()) {}

  addMemory(fact: string, source: string): MemoryEntry | null {
    const normalizedFact = normalizeFact(fact);
    const normalizedSource = normalizeSource(source);
    if (!normalizedFact || !normalizedSource) return null;

    const now = new Date();
    const existing = this.memories.find((entry) => entry.fact.toLowerCase() === normalizedFact.toLowerCase());
    if (existing) {
      existing.fact = normalizedFact;
      existing.source = normalizedSource;
      existing.confidence = Math.max(existing.confidence, defaultConfidence(normalizedSource));
      existing.lastUsedAt = now;
      existing.usageCount += 1;
      return cloneMemory(existing);
    }

    const created: MemoryEntry = {
      id: randomUUID(),
      fact: normalizedFact,
      source: normalizedSource,
      confidence: defaultConfidence(normalizedSource),
      createdAt: now,
      lastUsedAt: now,
      usageCount: 1,
    };
    this.memories.push(created);
    return cloneMemory(created);
  }

  getRelevantMemories(context: string, limit = 10): MemoryEntry[] {
    this.prune();
    const normalizedLimit = normalizeLimit(limit);
    const ranked = rankMemories(this.memories, context).slice(0, normalizedLimit);
    if (ranked.length === 0) return [];

    const now = new Date();
    const selectedIds = new Set(ranked.map((entry) => entry.id));
    for (const memory of this.memories) {
      if (!selectedIds.has(memory.id)) continue;
      memory.lastUsedAt = now;
      memory.usageCount += 1;
    }
    return ranked.map(cloneMemory);
  }

  toPromptContext(): string {
    return formatMemoriesAsPrompt(topMemories(this.memories, DEFAULT_PROMPT_LIMIT));
  }

  prune(maxAge = DEFAULT_PRUNE_AGE_DAYS): void {
    const maxAgeDays = Number.isFinite(maxAge) ? Math.max(0, Math.trunc(maxAge)) : DEFAULT_PRUNE_AGE_DAYS;
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.memories = this.memories.filter((entry) => {
      const freshest = Math.max(entry.createdAt.getTime(), entry.lastUsedAt.getTime());
      return freshest >= cutoff;
    });
  }

  forget(id: string): boolean {
    const normalizedId = id.trim();
    const before = this.memories.length;
    this.memories = this.memories.filter((entry) => entry.id !== normalizedId);
    return this.memories.length !== before;
  }

  clear(): void {
    this.memories = [];
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const payload = this.memories.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      lastUsedAt: entry.lastUsedAt.toISOString(),
    }));
    fs.writeFileSync(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  load(): void {
    this.memories = [];
    if (!fs.existsSync(this.storePath) || !fs.statSync(this.storePath).isFile()) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      this.memories = parsed.flatMap((value) => {
        const normalized = normalizeStoredMemory(value);
        return normalized ? [normalized] : [];
      });
      this.prune();
    } catch {
      this.memories = [];
    }
  }
}

export function extractMemories(userMessage: string, aiResponse: string): string[] {
  return detectMemoryCandidates(userMessage, aiResponse).map((candidate) => candidate.fact);
}

export function learnAutoMemories(userMessage: string, aiResponse: string): MemoryEntry[] {
  try {
    const memory = new AutoMemory();
    memory.load();
    const learned: MemoryEntry[] = [];
    for (const candidate of detectMemoryCandidates(userMessage, aiResponse)) {
      const entry = memory.addMemory(candidate.fact, candidate.source);
      if (entry) learned.push(entry);
    }
    if (learned.length > 0) {
      memory.prune();
      memory.save();
    }
    return learned;
  } catch {
    return [];
  }
}

export function loadAutoMemoryPromptContext(context: string, limit = DEFAULT_PROMPT_LIMIT): string | null {
  try {
    const memory = new AutoMemory();
    memory.load();
    const relevant = memory.getRelevantMemories(context, limit);
    if (relevant.length === 0) return null;
    memory.save();
    return formatMemoriesAsPrompt(relevant);
  } catch {
    return null;
  }
}

export function resolveAutoMemoryPath(): string {
  const configured =
    process.env.ICOPILOT_AUTO_MEMORY_PATH || path.join(os.homedir(), '.icopilot', 'auto-memory.json');
  if (configured === '~') return os.homedir();
  if (/^~[\\/]/.test(configured)) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

function detectMemoryCandidates(userMessage: string, aiResponse: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  candidates.push(...extractCorrectionCandidates(userMessage));
  candidates.push(...extractPreferenceCandidates(userMessage));
  candidates.push(...extractDiscoveryCandidates(aiResponse));
  return dedupeCandidates(candidates);
}

function extractCorrectionCandidates(message: string): MemoryCandidate[] {
  const trimmed = message.trim();
  if (!trimmed) return [];

  const candidates: MemoryCandidate[] = [];
  const useInsteadPattern =
    /\b(?:use|prefer)\s+(.+?)\s+instead of\s+(.+?)(?:[.!?]|$)/gi;
  for (const match of trimmed.matchAll(useInsteadPattern)) {
    const preferred = cleanupClause(match[1]);
    const previous = cleanupClause(match[2]);
    if (!preferred || !previous) continue;
    candidates.push({
      fact: `Use ${preferred} instead of ${previous}.`,
      source: 'correction',
    });
  }

  const shouldBePattern =
    /\b(?:actually|instead|correction:?|it should be|the command is|it is)\s+(.+?)(?:[.!?]|$)/i;
  const correctionMatch = trimmed.match(shouldBePattern);
  if (correctionMatch?.[1]) {
    const clause = cleanupClause(correctionMatch[1]);
    if (clause) {
      candidates.push({
        fact: clause.endsWith('.') ? clause : `${clause}.`,
        source: 'correction',
      });
    }
  }

  return candidates;
}

function extractPreferenceCandidates(message: string): MemoryCandidate[] {
  const trimmed = message.trim();
  if (!trimmed) return [];

  const patterns: Array<{ regex: RegExp; prefix: string }> = [
    { regex: /\bI prefer\s+(.+?)(?:[.!?]|$)/i, prefix: 'User preference: prefer ' },
    { regex: /\balways use\s+(.+?)(?:[.!?]|$)/i, prefix: 'User preference: always use ' },
    { regex: /\bplease use\s+(.+?)(?:[.!?]|$)/i, prefix: 'User preference: use ' },
  ];

  const candidates: MemoryCandidate[] = [];
  for (const { regex, prefix } of patterns) {
    const match = trimmed.match(regex);
    if (!match?.[1]) continue;
    const clause = cleanupClause(match[1]);
    if (!clause) continue;
    candidates.push({
      fact: `${prefix}${clause}.`,
      source: 'preference',
    });
  }
  return candidates;
}

function extractDiscoveryCandidates(response: string): MemoryCandidate[] {
  const text = response.trim();
  if (!text) return [];

  const candidates: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const rawCommand of text.matchAll(/`([^`\n]+)`/g)) {
    const command = cleanupClause(rawCommand[1]);
    if (!command) continue;
    const lower = command.toLowerCase();
    const fact = classifyCommandMemory(command, lower);
    if (!fact) continue;
    if (seen.has(fact)) continue;
    seen.add(fact);
    candidates.push({ fact, source: 'discovery' });
  }

  for (const sentence of splitSentences(text)) {
    if (!/[A-Za-z0-9._-]+[\\/][A-Za-z0-9._/-]+/.test(sentence)) continue;
    if (!/\b(?:lives?|located|under|contains?|entry point|root|folder|directory|structure)\b/i.test(sentence)) {
      continue;
    }
    const fact = normalizeFact(sentence);
    if (!fact || seen.has(fact)) continue;
    seen.add(fact);
    candidates.push({ fact, source: 'discovery' });
  }

  return candidates;
}

function classifyCommandMemory(command: string, lower: string): string | null {
  if (/\b(?:vitest|jest|mocha|ava|pytest|cargo test|go test|npm test|pnpm test|yarn test)\b/.test(lower)) {
    return `Project test command: ${command}.`;
  }
  if (/\b(?:tsc|build|compile|webpack|vite build|mvn package|gradle build|cargo build)\b/.test(lower)) {
    return `Project build command: ${command}.`;
  }
  if (/\b(?:eslint|lint|ruff|flake8|golangci-lint|clippy)\b/.test(lower)) {
    return `Project lint command: ${command}.`;
  }
  return null;
}

function formatMemoriesAsPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  return [
    'Auto-learned project memories:',
    ...memories.map(
      (entry) =>
        `- [${entry.source}, ${entry.confidence.toFixed(2)}] ${entry.fact}`,
    ),
  ].join('\n');
}

function normalizeStoredMemory(value: unknown): MemoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fact = typeof record.fact === 'string' ? normalizeFact(record.fact) : '';
  const source = normalizeSource(typeof record.source === 'string' ? record.source : '');
  const createdAt = coerceDate(record.createdAt);
  const lastUsedAt = coerceDate(record.lastUsedAt);
  if (!fact || !source || typeof record.id !== 'string' || !createdAt || !lastUsedAt) return null;
  const confidence = coerceConfidence(record.confidence, defaultConfidence(source));
  const usageCount =
    typeof record.usageCount === 'number' && Number.isFinite(record.usageCount)
      ? Math.max(1, Math.trunc(record.usageCount))
      : 1;
  return {
    id: record.id,
    fact,
    source,
    confidence,
    createdAt,
    lastUsedAt,
    usageCount,
  };
}

function rankMemories(memories: MemoryEntry[], context: string): MemoryEntry[] {
  const normalizedContext = context.trim().toLowerCase();
  if (!normalizedContext) return topMemories(memories, DEFAULT_PROMPT_LIMIT);

  return [...memories]
    .map((entry) => ({ entry, score: scoreMemory(entry, normalizedContext) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return compareMemories(left.entry, right.entry);
    })
    .map((candidate) => candidate.entry);
}

function topMemories(memories: MemoryEntry[], limit: number): MemoryEntry[] {
  return [...memories].sort(compareMemories).slice(0, normalizeLimit(limit));
}

function compareMemories(left: MemoryEntry, right: MemoryEntry): number {
  if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  return right.lastUsedAt.getTime() - left.lastUsedAt.getTime();
}

function scoreMemory(entry: MemoryEntry, context: string): number {
  let score = 0;
  const fact = entry.fact.toLowerCase();
  const tokens = tokenize(context);
  if (fact.includes(context) || context.includes(fact)) score += 8;
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (fact.includes(token)) score += 2;
  }
  score += Math.min(entry.usageCount, 5);
  score += entry.confidence;
  return score;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function cleanupClause(value: string): string {
  return value
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,:;\s-]+/, '')
    .replace(/[,:;\s-]+$/, '')
    .trim();
}

function normalizeFact(fact: string): string {
  const normalized = cleanupClause(fact).replace(/\s+/g, ' ');
  if (!normalized) return '';
  const withPunctuation = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return withPunctuation.slice(0, MAX_FACT_LENGTH).trim();
}

function normalizeSource(source: string): MemorySource | null {
  if (source === 'correction' || source === 'discovery' || source === 'preference') return source;
  return null;
}

function defaultConfidence(source: MemorySource): number {
  switch (source) {
    case 'correction':
      return 0.95;
    case 'preference':
      return 0.9;
    case 'discovery':
    default:
      return 0.75;
  }
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function coerceConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.trunc(limit));
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const deduped = new Map<string, MemoryCandidate>();
  for (const candidate of candidates) {
    const fact = normalizeFact(candidate.fact);
    if (!fact) continue;
    const key = fact.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, { fact, source: candidate.source });
    }
  }
  return [...deduped.values()];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function cloneMemory(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
    lastUsedAt: new Date(entry.lastUsedAt),
  };
}
