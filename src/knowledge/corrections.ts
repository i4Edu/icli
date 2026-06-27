import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Correction {
  id: string;
  pattern: string;
  wrongBehavior: string;
  correctBehavior: string;
  category: string;
  timestamp: number;
  frequency: number;
}

export class CorrectionMemory {
  private corrections: Correction[] = [];

  constructor(private readonly storePath = resolveCorrectionsPath()) {}

  add(correction: Omit<Correction, 'id' | 'timestamp' | 'frequency'>): void {
    const normalized = normalizeDraft(correction);
    if (!normalized) return;

    const existing = this.corrections.find((entry) => isSameCorrection(entry, normalized));
    if (existing) {
      existing.pattern = normalized.pattern;
      existing.wrongBehavior = normalized.wrongBehavior;
      existing.correctBehavior = normalized.correctBehavior;
      existing.category = normalized.category;
      existing.timestamp = Date.now();
      existing.frequency += 1;
      return;
    }

    this.corrections.push({
      id: randomUUID(),
      timestamp: Date.now(),
      frequency: 1,
      ...normalized,
    });
  }

  remove(id: string): void {
    const normalizedId = id.trim();
    if (!normalizedId) return;
    this.corrections = this.corrections.filter((entry) => entry.id !== normalizedId);
  }

  list(): Correction[] {
    return sortCorrections(this.corrections).map(cloneCorrection);
  }

  search(query: string): Correction[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return this.list();
    return this.list().filter((entry) => searchableText(entry).includes(normalizedQuery));
  }

  getRelevant(context: string): Correction[] {
    const normalizedContext = context.trim().toLowerCase();
    if (!normalizedContext) return this.list().slice(0, 5);

    const scored = this.corrections
      .map((entry) => ({ entry, score: scoreCorrection(entry, normalizedContext) }))
      .filter((candidate) => candidate.score >= 2)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.entry.frequency !== left.entry.frequency) {
          return right.entry.frequency - left.entry.frequency;
        }
        return right.entry.timestamp - left.entry.timestamp;
      })
      .slice(0, 5)
      .map((candidate) => cloneCorrection(candidate.entry));

    return scored;
  }

  toPromptContext(): string {
    return formatCorrectionsAsPrompt(this.list());
  }

  incrementFrequency(id: string): void {
    const normalizedId = id.trim();
    if (!normalizedId) return;
    const correction = this.corrections.find((entry) => entry.id === normalizedId);
    if (!correction) return;
    correction.frequency += 1;
    correction.timestamp = Date.now();
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(this.list(), null, 2)}\n`, 'utf8');
  }

  load(): void {
    this.corrections = [];
    if (!fs.existsSync(this.storePath) || !fs.statSync(this.storePath).isFile()) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      this.corrections = parsed.flatMap((entry) => {
        const normalized = normalizeStoredCorrection(entry);
        return normalized ? [normalized] : [];
      });
    } catch {
      this.corrections = [];
    }
  }
}

export function resolveCorrectionsPath(): string {
  const configured = process.env.ICOPILOT_CORRECTIONS_PATH || path.join(os.homedir(), '.icopilot', 'corrections.json');
  if (configured === '~') return os.homedir();
  if (/^~[\\/]/.test(configured)) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

export function formatCorrectionsAsPrompt(corrections: Correction[]): string {
  if (corrections.length === 0) return '';

  const lines = corrections.map((entry) => {
    const qualifier =
      entry.pattern.toLowerCase() === entry.wrongBehavior.toLowerCase()
        ? ''
        : ` when the request matches "${entry.pattern}"`;
    return `- Do NOT ${entry.wrongBehavior}${qualifier}. Instead, ${entry.correctBehavior}.`;
  });

  return ['User corrections to obey:', ...lines].join('\n');
}

export function loadCorrectionPromptContext(context: string): string | null {
  const memory = new CorrectionMemory();
  memory.load();
  const relevant = memory.getRelevant(context);
  if (relevant.length === 0) return null;
  return formatCorrectionsAsPrompt(relevant);
}

function cloneCorrection(correction: Correction): Correction {
  return { ...correction };
}

function normalizeDraft(correction: Omit<Correction, 'id' | 'timestamp' | 'frequency'>): Omit<Correction, 'id' | 'timestamp' | 'frequency'> | null {
  const pattern = correction.pattern.trim();
  const wrongBehavior = correction.wrongBehavior.trim();
  const correctBehavior = correction.correctBehavior.trim();
  const category = correction.category.trim();

  if (!pattern || !wrongBehavior || !correctBehavior || !category) return null;

  return {
    pattern,
    wrongBehavior,
    correctBehavior,
    category,
  };
}

function normalizeStoredCorrection(value: unknown): Correction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const draft = normalizeDraft({
    pattern: typeof record.pattern === 'string' ? record.pattern : '',
    wrongBehavior: typeof record.wrongBehavior === 'string' ? record.wrongBehavior : '',
    correctBehavior: typeof record.correctBehavior === 'string' ? record.correctBehavior : '',
    category: typeof record.category === 'string' ? record.category : '',
  });
  if (!draft || typeof record.id !== 'string') return null;

  return {
    id: record.id,
    timestamp: Number.isFinite(record.timestamp) ? Number(record.timestamp) : Date.now(),
    frequency: Number.isFinite(record.frequency) ? Math.max(1, Number(record.frequency)) : 1,
    ...draft,
  };
}

function searchableText(correction: Correction): string {
  return [
    correction.pattern,
    correction.wrongBehavior,
    correction.correctBehavior,
    correction.category,
  ]
    .join('\n')
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreCorrection(correction: Correction, context: string): number {
  let score = 0;
  const haystack = searchableText(correction);
  const pattern = correction.pattern.toLowerCase();

  if (context.includes(pattern) || pattern.includes(context)) {
    score += 10;
  }

  for (const token of tokenize(context)) {
    if (token.length < 4) continue;
    if (pattern.includes(token)) {
      score += 3;
      continue;
    }
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function sortCorrections(corrections: Correction[]): Correction[] {
  return [...corrections].sort((left, right) => {
    if (right.frequency !== left.frequency) return right.frequency - left.frequency;
    return right.timestamp - left.timestamp;
  });
}

function isSameCorrection(
  left: Correction | Omit<Correction, 'id' | 'timestamp' | 'frequency'>,
  right: Omit<Correction, 'id' | 'timestamp' | 'frequency'>,
): boolean {
  return (
    left.pattern.toLowerCase() === right.pattern.toLowerCase() &&
    left.wrongBehavior.toLowerCase() === right.wrongBehavior.toLowerCase() &&
    left.correctBehavior.toLowerCase() === right.correctBehavior.toLowerCase() &&
    left.category.toLowerCase() === right.category.toLowerCase()
  );
}
