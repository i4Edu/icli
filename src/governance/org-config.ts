import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface OrgConfig {
  name: string;
  defaults: Record<string, unknown>;
  policies: string[];
  inheritFrom?: string;
  allowedModels?: string[];
  deniedTools?: string[];
}

const ORG_CONFIG_FILE = path.join('.icopilot', 'org.yaml');

export function loadOrgConfig(cwd = config.cwd): OrgConfig | null {
  const configPath = path.join(cwd, ORG_CONFIG_FILE);
  try {
    if (!fs.existsSync(configPath)) return null;
    const parsed = parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    const validation = validateOrgConfig(parsed);
    if (!validation.valid) return null;
    return normalizeOrgConfig(parsed);
  } catch {
    return null;
  }
}

export function mergeOrgDefaults(
  orgConfig: OrgConfig,
  localConfig: Record<string, unknown>,
): Record<string, unknown> {
  return mergeRecords(orgConfig.defaults, localConfig);
}

export function validateOrgConfig(configValue: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(configValue)) {
    return { valid: false, errors: ['organization config must be a YAML object'] };
  }

  if (!isNonEmptyString(configValue.name)) {
    errors.push('name must be a non-empty string');
  }
  if (configValue.defaults !== undefined && !isRecord(configValue.defaults)) {
    errors.push('defaults must be an object');
  }
  if (!isStringArray(configValue.policies)) {
    errors.push('policies must be an array of non-empty strings');
  }
  if (configValue.inheritFrom !== undefined && !isNonEmptyString(configValue.inheritFrom)) {
    errors.push('inheritFrom must be a non-empty string when provided');
  }
  if (configValue.allowedModels !== undefined && !isStringArray(configValue.allowedModels)) {
    errors.push('allowedModels must be an array of non-empty strings when provided');
  }
  if (configValue.deniedTools !== undefined && !isStringArray(configValue.deniedTools)) {
    errors.push('deniedTools must be an array of non-empty strings when provided');
  }

  return { valid: errors.length === 0, errors };
}

export function formatOrgConfig(orgConfig: OrgConfig): string {
  const lines = [
    `${theme.brand('Organization')} ${theme.hl(orgConfig.name)}`,
    `  ${theme.dim('policies')} ${formatList(orgConfig.policies)}`,
    `  ${theme.dim('inherit')} ${orgConfig.inheritFrom ? theme.hl(orgConfig.inheritFrom) : theme.dim('none')}`,
    `  ${theme.dim('allowed models')} ${formatOptionalList(orgConfig.allowedModels)}`,
    `  ${theme.dim('denied tools')} ${formatOptionalList(orgConfig.deniedTools)}`,
    `  ${theme.dim('defaults')}`,
    indentBlock(stringify(orgConfig.defaults), 4),
  ];
  return `${lines.join('\n')}\n`;
}

function normalizeOrgConfig(configValue: unknown): OrgConfig {
  const record = configValue as Record<string, unknown>;
  return {
    name: String(record.name).trim(),
    defaults: isRecord(record.defaults) ? cloneRecord(record.defaults) : {},
    policies: normalizeStringArray(record.policies),
    inheritFrom: normalizeOptionalString(record.inheritFrom),
    allowedModels: normalizeOptionalStringArray(record.allowedModels),
    deniedTools: normalizeOptionalStringArray(record.deniedTools),
  };
}

function mergeRecords(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged = cloneRecord(base);
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key];
    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergeRecords(existing, value);
      continue;
    }
    merged[key] = cloneUnknown(value);
  }
  return merged;
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cloneUnknown(value)]),
  );
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneUnknown(entry));
  if (isRecord(value)) return cloneRecord(value);
  return value;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(isNonEmptyString).map((entry) => entry.trim()))]
    : [];
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  const normalized = normalizeStringArray(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.map((value) => theme.hl(value)).join(', ') : theme.dim('none');
}

function formatOptionalList(values: string[] | undefined): string {
  return values && values.length > 0
    ? values.map((value) => theme.hl(value)).join(', ')
    : theme.dim('none');
}

function indentBlock(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
