import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export type FilterType = 'pii' | 'secret' | 'custom';
export type FilterAction = 'redact' | 'warn' | 'block';

export interface FilterRule {
  name: string;
  pattern: RegExp;
  type: FilterType;
  action: FilterAction;
  replacement?: string;
}

export interface FilterMatch {
  name: string;
  match: string;
  index: number;
  end: number;
  type: FilterType;
  action: FilterAction;
  replacement?: string;
}

export interface FilterResult {
  original: string;
  filtered: string;
  matches: FilterMatch[];
  blocked: boolean;
  changed: boolean;
  redactions: number;
  warnings: number;
  blocks: number;
}

interface PersistedFilterRule {
  name: string;
  pattern: string;
  flags?: string;
  type?: FilterType;
  action?: FilterAction;
  replacement?: string;
}

interface FiltersConfigFile {
  disabled?: string[];
  rules?: PersistedFilterRule[];
}

const DEFAULT_FILTER_FLAGS = 'gi';

export const FILTERS_CONFIG_FILE = path.join('.icopilot', 'filters.yaml');

const BUILTIN_FILTER_RULES: FilterRule[] = [
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    type: 'pii',
    action: 'redact',
    replacement: '[REDACTED:EMAIL]',
  },
  {
    name: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
    type: 'pii',
    action: 'redact',
    replacement: '[REDACTED:PHONE]',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    type: 'pii',
    action: 'redact',
    replacement: '[REDACTED:SSN]',
  },
  {
    name: 'credit-card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    type: 'pii',
    action: 'block',
    replacement: '[BLOCKED:CARD]',
  },
  {
    name: 'api-key',
    pattern:
      /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35})\b/g,
    type: 'secret',
    action: 'block',
    replacement: '[BLOCKED:API_KEY]',
  },
];

const BUILTIN_RULE_NAMES = new Set(BUILTIN_FILTER_RULES.map((rule) => rule.name.toLowerCase()));

export class ContentFilter {
  private readonly rules = new Map<string, FilterRule>();

  constructor(rules: FilterRule[] = builtinFilterRules()) {
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  addRule(rule: FilterRule): void {
    const normalized = normalizeRule(rule);
    this.rules.set(normalized.name.toLowerCase(), normalized);
  }

  removeRule(name: string): boolean {
    return this.rules.delete(name.trim().toLowerCase());
  }

  filter(text: string): FilterResult {
    const matches = this.scan(text);
    const replacements = selectReplacementMatches(matches);

    let cursor = 0;
    let filtered = '';
    for (const match of replacements) {
      filtered += text.slice(cursor, match.index);
      filtered += match.replacement ?? defaultReplacement(match.action, match.type);
      cursor = match.end;
    }
    filtered += text.slice(cursor);

    const blocks = matches.filter((match) => match.action === 'block').length;
    const redactions = matches.filter((match) => match.action === 'redact').length;
    const warnings = matches.filter((match) => match.action === 'warn').length;

    return {
      original: text,
      filtered,
      matches,
      blocked: blocks > 0,
      changed: filtered !== text,
      redactions,
      warnings,
      blocks,
    };
  }

  scan(text: string): FilterMatch[] {
    const matches: FilterMatch[] = [];

    for (const rule of this.rules.values()) {
      const matcher = toGlobalRegex(rule.pattern);
      let result: RegExpExecArray | null;

      while ((result = matcher.exec(text)) !== null) {
        const value = result[0] ?? '';
        if (!value) {
          matcher.lastIndex += 1;
          continue;
        }
        if (!shouldKeepMatch(rule, value)) {
          continue;
        }
        matches.push({
          name: rule.name,
          match: value,
          index: result.index,
          end: result.index + value.length,
          type: rule.type,
          action: rule.action,
          replacement:
            rule.action === 'warn'
              ? undefined
              : (rule.replacement ?? defaultReplacement(rule.action, rule.type)),
        });
      }
    }

    return matches.sort(compareMatches);
  }

  getRules(): FilterRule[] {
    return Array.from(this.rules.values())
      .map(cloneRule)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  isClean(text: string): boolean {
    return this.scan(text).length === 0;
  }
}

export function builtinFilterRules(): FilterRule[] {
  return BUILTIN_FILTER_RULES.map(cloneRule);
}

export function defaultFiltersConfigPath(cwd = config.cwd): string {
  return path.join(cwd, FILTERS_CONFIG_FILE);
}

export function loadProjectContentFilter(cwd = config.cwd): ContentFilter {
  const filter = new ContentFilter(builtinFilterRules());

  try {
    const configFile = readFiltersConfig(defaultFiltersConfigPath(cwd));
    for (const name of configFile.disabled ?? []) {
      filter.removeRule(name);
    }
    for (const rule of configFile.rules ?? []) {
      filter.addRule(hydrateRule(rule));
    }
  } catch {
    return filter;
  }

  return filter;
}

export function saveProjectFilterRule(cwd: string, rule: FilterRule): FilterRule {
  const configPath = defaultFiltersConfigPath(cwd);
  const configFile = readFiltersConfig(configPath);
  const normalized = normalizeRule(rule);
  const ruleName = normalized.name.toLowerCase();

  const nextConfig: FiltersConfigFile = {
    disabled: (configFile.disabled ?? []).filter((name) => name.toLowerCase() !== ruleName),
    rules: [
      ...(configFile.rules ?? []).filter((entry) => entry.name.toLowerCase() !== ruleName),
      dehydrateRule(normalized),
    ].sort((left, right) => left.name.localeCompare(right.name)),
  };

  writeFiltersConfig(configPath, nextConfig);
  return normalized;
}

export function removeProjectFilterRule(
  cwd: string,
  name: string,
): { removed: boolean; source: 'builtin' | 'custom' | null } {
  const target = name.trim().toLowerCase();
  const configPath = defaultFiltersConfigPath(cwd);
  const configFile = readFiltersConfig(configPath);
  const customRules = configFile.rules ?? [];
  const hadCustomRule = customRules.some((rule) => rule.name.toLowerCase() === target);

  const nextConfig: FiltersConfigFile = {
    disabled: [...new Set(configFile.disabled ?? [])],
    rules: customRules.filter((rule) => rule.name.toLowerCase() !== target),
  };

  if (hadCustomRule) {
    writeFiltersConfig(configPath, nextConfig);
    return { removed: true, source: 'custom' };
  }

  if (BUILTIN_RULE_NAMES.has(target)) {
    nextConfig.disabled = [...new Set([...(nextConfig.disabled ?? []), target])].sort(
      (left, right) => left.localeCompare(right),
    );
    writeFiltersConfig(configPath, nextConfig);
    return { removed: true, source: 'builtin' };
  }

  return { removed: false, source: null };
}

export function parseFilterAction(value: string): FilterAction | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'redact' || normalized === 'warn' || normalized === 'block'
    ? normalized
    : null;
}

export function parseFilterPattern(value: string): RegExp {
  const trimmed = value.trim();
  const inline = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (inline) {
    return new RegExp(inline[1] ?? '', inline[2] ?? '');
  }
  return new RegExp(trimmed, DEFAULT_FILTER_FLAGS);
}

export function formatFilterRules(filter: ContentFilter, cwd = config.cwd): string {
  const rules = filter.getRules();
  const lines = [`${theme.brand('Content filters')} ${theme.dim(defaultFiltersConfigPath(cwd))}`];

  if (rules.length === 0) {
    lines.push(`  ${theme.dim('No filter rules configured.')}`);
    return `${lines.join('\n')}\n`;
  }

  for (const rule of rules) {
    const source = BUILTIN_RULE_NAMES.has(rule.name.toLowerCase()) ? 'builtin' : 'custom';
    lines.push(
      `  ${theme.hl(rule.name)}  ${theme.dim(
        `${rule.type}/${rule.action}/${source} /${rule.pattern.source}/${rule.pattern.flags}`,
      )}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function formatFilterTestResult(result: FilterResult): string {
  const lines = [`${theme.brand('Content filter test')}`, `  status: ${statusLabel(result)}`];

  if (result.matches.length === 0) {
    lines.push(`  ${theme.ok('No matches found.')}`);
    return `${lines.join('\n')}\n`;
  }

  lines.push(`  summary: ${theme.dim(summarizeFilterResult(result))}`, '', theme.brand('Matches'));
  for (const match of result.matches) {
    lines.push(
      `  ${theme.hl(match.name)}  ${theme.dim(`${match.type}/${match.action}`)}  ` +
        `${theme.dim(`@${match.index}-${match.end}`)}`,
    );
  }
  lines.push('', theme.brand('Filtered output'), result.filtered);
  return `${lines.join('\n')}\n`;
}

export function summarizeFilterResult(result: FilterResult): string {
  const parts: string[] = [];
  if (result.redactions > 0)
    parts.push(`${result.redactions} redaction${result.redactions === 1 ? '' : 's'}`);
  if (result.blocks > 0) parts.push(`${result.blocks} block${result.blocks === 1 ? '' : 's'}`);
  if (result.warnings > 0)
    parts.push(`${result.warnings} warning${result.warnings === 1 ? '' : 's'}`);
  return parts.join(', ') || 'no matches';
}

function compareMatches(left: FilterMatch, right: FilterMatch): number {
  if (left.index !== right.index) return left.index - right.index;
  const actionDelta = actionPriority(right.action) - actionPriority(left.action);
  if (actionDelta !== 0) return actionDelta;
  return right.end - right.index - (left.end - left.index);
}

function selectReplacementMatches(matches: FilterMatch[]): FilterMatch[] {
  const selected: FilterMatch[] = [];
  let cursor = -1;

  for (const match of [...matches].sort(compareMatches)) {
    if (match.action === 'warn') continue;
    if (match.index < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }

  return selected;
}

function actionPriority(action: FilterAction): number {
  switch (action) {
    case 'block':
      return 3;
    case 'redact':
      return 2;
    case 'warn':
      return 1;
  }
}

function shouldKeepMatch(rule: FilterRule, value: string): boolean {
  if (rule.name.toLowerCase() === 'credit-card') {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  }
  return true;
}

function passesLuhn(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;

  for (let index = value.length - 1; index >= 0; index--) {
    let digit = Number(value[index]);
    if (Number.isNaN(digit)) return false;
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum > 0 && sum % 10 === 0;
}

function normalizeRule(rule: FilterRule): FilterRule {
  const name = rule.name.trim();
  if (!name) {
    throw new Error('Filter rule name must be a non-empty string.');
  }
  if (!(rule.pattern instanceof RegExp)) {
    throw new Error(`Filter rule "${name}" must use a valid regular expression.`);
  }
  return {
    name,
    pattern: new RegExp(rule.pattern.source, rule.pattern.flags),
    type: rule.type,
    action: rule.action,
    replacement: rule.replacement?.trim() || undefined,
  };
}

function cloneRule(rule: FilterRule): FilterRule {
  return {
    ...rule,
    pattern: new RegExp(rule.pattern.source, rule.pattern.flags),
  };
}

function toGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function defaultReplacement(action: FilterAction, type: FilterType): string {
  return `[${action === 'block' ? 'BLOCKED' : 'REDACTED'}:${type.toUpperCase()}]`;
}

function readFiltersConfig(filePath: string): FiltersConfigFile {
  if (!fs.existsSync(filePath)) {
    return { disabled: [], rules: [] };
  }

  const document = parseDocument(fs.readFileSync(filePath, 'utf8'));
  if (document.errors.length > 0) {
    throw document.errors[0] ?? new Error('Invalid content filter YAML.');
  }

  return parseFiltersConfig(document.toJSON());
}

function parseFiltersConfig(value: unknown): FiltersConfigFile {
  if (!value) {
    return { disabled: [], rules: [] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('filters config must contain a YAML object');
  }

  const record = value as Record<string, unknown>;
  const disabled =
    record.disabled === undefined
      ? []
      : parseStringArray(record.disabled, 'disabled').map((entry) => entry.toLowerCase());
  const rules =
    record.rules === undefined
      ? []
      : parseRuleList(record.rules).sort((left, right) => left.name.localeCompare(right.name));

  return {
    disabled: [...new Set(disabled)],
    rules,
  };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`filters config field "${field}" must be an array`);
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`filters config field "${field}" must contain non-empty strings`);
    }
    return entry.trim();
  });
}

function parseRuleList(value: unknown): PersistedFilterRule[] {
  if (!Array.isArray(value)) {
    throw new Error('filters config field "rules" must be an array');
  }
  return value.map(validatePersistedRule);
}

function validatePersistedRule(value: unknown): PersistedFilterRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('filter rules must be YAML objects');
  }

  const record = value as Record<string, unknown>;
  const name = requireString(record.name, 'name');
  const pattern = requireString(record.pattern, 'pattern');
  const type = parseRuleType(record.type);
  const action = parseRuleAction(record.action);
  const flags = optionalString(record.flags, 'flags');
  const replacement = optionalString(record.replacement, 'replacement');

  try {
    new RegExp(pattern, flags ?? '');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`filter rule "${name}" has an invalid pattern: ${message}`);
  }

  return {
    name,
    pattern,
    flags,
    type,
    action,
    replacement,
  };
}

function hydrateRule(rule: PersistedFilterRule): FilterRule {
  return normalizeRule({
    name: rule.name,
    pattern: new RegExp(rule.pattern, rule.flags ?? ''),
    type: rule.type ?? 'custom',
    action: rule.action ?? 'warn',
    replacement: rule.replacement,
  });
}

function dehydrateRule(rule: FilterRule): PersistedFilterRule {
  return {
    name: rule.name,
    pattern: rule.pattern.source,
    flags: rule.pattern.flags || undefined,
    type: rule.type,
    action: rule.action,
    replacement: rule.replacement,
  };
}

function writeFiltersConfig(filePath: string, configFile: FiltersConfigFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    stringify({
      disabled: [...new Set(configFile.disabled ?? [])].sort((left, right) =>
        left.localeCompare(right),
      ),
      rules: [...(configFile.rules ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    } satisfies FiltersConfigFile),
    'utf8',
  );
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`filters config field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`filters config field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function parseRuleType(value: unknown): FilterType | undefined {
  if (value === undefined) return undefined;
  if (value === 'pii' || value === 'secret' || value === 'custom') return value;
  throw new Error('filters config field "type" must be pii, secret, or custom');
}

function parseRuleAction(value: unknown): FilterAction | undefined {
  if (value === undefined) return undefined;
  if (value === 'redact' || value === 'warn' || value === 'block') return value;
  throw new Error('filters config field "action" must be redact, warn, or block');
}

function statusLabel(result: FilterResult): string {
  if (result.blocked) return theme.err('blocked');
  if (result.changed) return theme.warn('filtered');
  return theme.ok('clean');
}
