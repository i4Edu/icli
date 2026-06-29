import fs from 'node:fs';
import path from 'node:path';

export interface StyleProfile {
  indentation: string;
  quotes: string;
  semicolons: string;
  trailingComma: string;
  namingConvention: string;
  importStyle: string;
  functionStyle: string;
  commentStyle: string;
  maxLineLength: number;
}

interface StyleStats {
  indentation: Record<string, number>;
  quotes: Record<string, number>;
  semicolons: Record<string, number>;
  trailingComma: Record<string, number>;
  namingConvention: Record<string, number>;
  importForms: Record<string, number>;
  importGroups: number;
  importFiles: number;
  functionStyle: Record<string, number>;
  commentStyle: Record<string, number>;
  lineLengths: number[];
}

interface StyleProfileDocument {
  profile: StyleProfile;
  stats?: StyleStats;
}

const DEFAULT_PROFILE: StyleProfile = {
  indentation: '2 spaces',
  quotes: 'single',
  semicolons: 'always',
  trailingComma: 'always',
  namingConvention: 'camelCase',
  importStyle: 'named imports, single block',
  functionStyle: 'arrow',
  commentStyle: 'line',
  maxLineLength: 100,
};

const DEFAULT_STATS = (): StyleStats => ({
  indentation: {},
  quotes: {},
  semicolons: {},
  trailingComma: {},
  namingConvention: {},
  importForms: {},
  importGroups: 0,
  importFiles: 0,
  functionStyle: {},
  commentStyle: {},
  lineLengths: [],
});

const IDENTIFIER_DECLARATION =
  /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

export class StyleLearner {
  private profile: StyleProfile;

  private stats: StyleStats;

  constructor(profile: StyleProfile = DEFAULT_PROFILE) {
    this.profile = { ...profile };
    this.stats = DEFAULT_STATS();
  }

  analyze(files: string[]): StyleProfile {
    this.stats = DEFAULT_STATS();
    for (const file of files) {
      this.learnFromFile(file);
    }
    this.profile = this.buildProfile();
    return this.getProfile();
  }

  learnFromFile(filePath: string): void {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
    const source = fs.readFileSync(filePath, 'utf8');
    this.collectIndentation(source);
    this.collectQuotes(source);
    this.collectSemicolons(source);
    this.collectTrailingCommas(source);
    this.collectNaming(source);
    this.collectFunctions(source);
    this.collectImports(source);
    this.collectComments(source);
    this.collectLineLengths(source);
    this.profile = this.buildProfile();
  }

  getProfile(): StyleProfile {
    return { ...this.profile };
  }

  toPromptContext(): string {
    const profile = this.profile;
    return [
      'Follow the project style profile when generating code:',
      `- Indentation: ${profile.indentation}`,
      `- Quotes: ${profile.quotes}`,
      `- Semicolons: ${profile.semicolons}`,
      `- Trailing commas: ${profile.trailingComma}`,
      `- Naming convention: ${profile.namingConvention}`,
      `- Imports: ${profile.importStyle}`,
      `- Functions: prefer ${profile.functionStyle}`,
      `- Comments: prefer ${profile.commentStyle} comments`,
      `- Keep lines around ${profile.maxLineLength} characters when practical`,
    ].join('\n');
  }

  save(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const document: StyleProfileDocument = {
      profile: this.profile,
      stats: this.stats,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }

  load(filePath: string): void {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as
      | StyleProfile
      | StyleProfileDocument;
    if (isStyleProfileDocument(parsed)) {
      this.profile = { ...DEFAULT_PROFILE, ...parsed.profile };
      this.stats = parsed.stats ? normalizeStats(parsed.stats) : DEFAULT_STATS();
      return;
    }
    this.profile = { ...DEFAULT_PROFILE, ...parsed };
    this.stats = DEFAULT_STATS();
  }

  private buildProfile(): StyleProfile {
    const importForm = dominant(this.stats.importForms, 'named');
    const groupedImports =
      this.stats.importFiles > 0 && this.stats.importGroups / this.stats.importFiles > 1;

    return {
      indentation: dominant(this.stats.indentation, DEFAULT_PROFILE.indentation),
      quotes: dominant(this.stats.quotes, DEFAULT_PROFILE.quotes),
      semicolons: dominant(this.stats.semicolons, DEFAULT_PROFILE.semicolons),
      trailingComma: dominant(this.stats.trailingComma, DEFAULT_PROFILE.trailingComma),
      namingConvention: dominant(this.stats.namingConvention, DEFAULT_PROFILE.namingConvention),
      importStyle: `${importForm} imports, ${groupedImports ? 'grouped' : 'single block'}`,
      functionStyle: dominant(this.stats.functionStyle, DEFAULT_PROFILE.functionStyle),
      commentStyle: dominant(this.stats.commentStyle, DEFAULT_PROFILE.commentStyle),
      maxLineLength: inferLineLength(this.stats.lineLengths),
    };
  }

  private collectIndentation(source: string): void {
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = line.match(/^[\t ]+/);
      if (!match) continue;
      const indent = match[0];
      if (indent.includes('\t') && !indent.includes(' ')) {
        bump(this.stats.indentation, 'tabs');
        continue;
      }
      if (indent.includes(' ')) {
        bump(this.stats.indentation, `${indent.length} spaces`);
      }
    }
  }

  private collectQuotes(source: string): void {
    const single = source.match(/'([^'\\]|\\.)*'/g)?.length ?? 0;
    const double = source.match(/"([^"\\]|\\.)*"/g)?.length ?? 0;
    if (single > 0) bump(this.stats.quotes, 'single', single);
    if (double > 0) bump(this.stats.quotes, 'double', double);
  }

  private collectSemicolons(source: string): void {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!looksLikeStatement(trimmed)) continue;
      if (/;\s*(?:\/\/.*)?$/.test(trimmed)) {
        bump(this.stats.semicolons, 'always');
      } else {
        bump(this.stats.semicolons, 'never');
      }
    }
  }

  private collectTrailingCommas(source: string): void {
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index++) {
      const current = lines[index].trimEnd();
      const next = lines[index + 1].trimStart();
      if (!current.trim() || !/^[}\]]/.test(next)) continue;
      if (current.trim().endsWith(',')) {
        bump(this.stats.trailingComma, 'always');
      } else if (/[A-Za-z0-9_'")\]}]$/.test(current.trim())) {
        bump(this.stats.trailingComma, 'never');
      }
    }
  }

  private collectNaming(source: string): void {
    for (const match of source.matchAll(IDENTIFIER_DECLARATION)) {
      const name = match[1];
      const convention = classifyName(name);
      if (convention) bump(this.stats.namingConvention, convention);
    }
  }

  private collectFunctions(source: string): void {
    const arrowCount = source.match(/=>/g)?.length ?? 0;
    const functionCount = source.match(/\bfunction\b/g)?.length ?? 0;
    if (arrowCount > 0) bump(this.stats.functionStyle, 'arrow', arrowCount);
    if (functionCount > 0) bump(this.stats.functionStyle, 'function', functionCount);
  }

  private collectImports(source: string): void {
    const importLines = source.match(/^import\s.+$/gm) ?? [];
    if (importLines.length === 0) return;

    const blocks = source
      .split(/\r?\n\r?\n+/)
      .map((block) => block.trim())
      .filter((block) => block.startsWith('import '));

    this.stats.importGroups += blocks.length;
    this.stats.importFiles += 1;

    for (const line of importLines) {
      const match = line.match(/^import\s+(.+?)\s+from\s+['"]/);
      if (!match) continue;
      const specifier = match[1].trim();
      if (specifier.startsWith('{')) {
        bump(this.stats.importForms, 'named');
      } else if (specifier.includes('{')) {
        bump(this.stats.importForms, 'mixed');
      } else {
        bump(this.stats.importForms, 'default');
      }
    }
  }

  private collectComments(source: string): void {
    const lineComments = source.match(/^\s*\/\/.+$/gm)?.length ?? 0;
    const blockComments = source.match(/\/\*[\s\S]*?\*\//g)?.length ?? 0;
    if (lineComments > 0) bump(this.stats.commentStyle, 'line', lineComments);
    if (blockComments > 0) bump(this.stats.commentStyle, 'block', blockComments);
  }

  private collectLineLengths(source: string): void {
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.stats.lineLengths.push(line.length);
    }
  }
}

export function resolveStyleProfilePath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'style-profile.json');
}

export function loadStyleProfile(cwd: string): StyleProfile | null {
  const profilePath = resolveStyleProfilePath(cwd);
  if (!fs.existsSync(profilePath)) return null;
  const learner = new StyleLearner();
  learner.load(profilePath);
  return learner.getProfile();
}

export function loadStylePromptContext(cwd: string): string | null {
  const profilePath = resolveStyleProfilePath(cwd);
  if (!fs.existsSync(profilePath)) return null;
  try {
    const learner = new StyleLearner();
    learner.load(profilePath);
    return learner.toPromptContext();
  } catch {
    return null;
  }
}

export function resetStyleProfile(cwd: string): boolean {
  const profilePath = resolveStyleProfilePath(cwd);
  if (!fs.existsSync(profilePath)) return false;
  fs.rmSync(profilePath, { force: true });
  return true;
}

function bump(counter: Record<string, number>, key: string, amount = 1): void {
  counter[key] = (counter[key] ?? 0) + amount;
}

function dominant(counter: Record<string, number>, fallback: string): string {
  let winner = fallback;
  let score = -1;
  for (const [key, value] of Object.entries(counter)) {
    if (value > score) {
      winner = key;
      score = value;
    }
  }
  return winner;
}

function inferLineLength(lengths: number[]): number {
  if (lengths.length === 0) return DEFAULT_PROFILE.maxLineLength;
  const sorted = [...lengths].sort((left, right) => left - right);
  const percentile = sorted[Math.max(0, Math.floor(sorted.length * 0.9) - 1)];
  const rounded = Math.ceil(percentile / 10) * 10;
  const common = [80, 88, 90, 100, 120];
  let closest = rounded;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of common) {
    const distance = Math.abs(candidate - percentile);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closestDistance <= 12 ? closest : Math.max(80, rounded);
}

function classifyName(name: string): string | null {
  if (!name || /^[A-Z0-9_]+$/.test(name)) return null;
  if (/^[a-z][A-Za-z0-9]*$/.test(name)) return 'camelCase';
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes('_')) return 'snake_case';
  return null;
}

function looksLikeStatement(line: string): boolean {
  if (!line) return false;
  if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) return false;
  if (/^[{}[\],]+$/.test(line)) return false;
  if (/[{:,]$/.test(line)) return false;
  return true;
}

function isStyleProfileDocument(value: unknown): value is StyleProfileDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'profile' in value;
}

function normalizeStats(stats: StyleStats): StyleStats {
  return {
    indentation: { ...stats.indentation },
    quotes: { ...stats.quotes },
    semicolons: { ...stats.semicolons },
    trailingComma: { ...stats.trailingComma },
    namingConvention: { ...stats.namingConvention },
    importForms: { ...stats.importForms },
    importGroups: Number(stats.importGroups) || 0,
    importFiles: Number(stats.importFiles) || 0,
    functionStyle: { ...stats.functionStyle },
    commentStyle: { ...stats.commentStyle },
    lineLengths: Array.isArray(stats.lineLengths) ? stats.lineLengths.filter(Number.isFinite) : [],
  };
}
