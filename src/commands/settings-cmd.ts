import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  getDefaultConfig,
  rcFilePath,
  type Config,
  type LogLevel,
  type ReasoningEffort,
  type ThemeName,
} from '../config.js';
import { theme } from '../ui/theme.js';

type PublicSettingKey =
  | 'model'
  | 'theme'
  | 'editFormat'
  | 'autoLint'
  | 'autoTest'
  | 'reasoningEffort'
  | 'thinkTokens'
  | 'sandbox'
  | 'contextWindow'
  | 'contextWarn'
  | 'autoCompact'
  | 'autoCompactThreshold'
  | 'verbose'
  | 'logLevel'
  | 'sessionDir'
  | 'endpoint'
  | 'policyPath'
  | 'jsonOutput'
  | 'quiet'
  | 'autoApprove';

type ConfigKey = keyof Config;

interface SettingDefinition<T = unknown> {
  key: PublicSettingKey;
  configKey: ConfigKey;
  aliases?: string[];
  parse: (value: string) => T;
  format?: (value: any) => string;
}

const BOOLEAN_TRUE = /^(1|true|yes|on)$/i;
const BOOLEAN_FALSE = /^(0|false|no|off)$/i;
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const THEMES: ThemeName[] = ['auto', 'light', 'dark', 'none'];
const REASONING_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'max'];

const SETTING_DEFINITIONS: SettingDefinition<any>[] = [
  textSetting('model', 'defaultModel', ['defaultModel']),
  enumSetting('theme', 'theme', THEMES),
  enumSetting('editFormat', 'editFormat', ['whole', 'diff'], ['edit-format']),
  booleanSetting('autoLint', 'autoLint', ['auto-lint']),
  booleanSetting('autoTest', 'autoTest', ['auto-test']),
  optionalEnumSetting('reasoningEffort', 'reasoningEffort', REASONING_LEVELS, [
    'reasoning',
    'reasoning-effort',
  ]),
  optionalNumberSetting('thinkTokens', 'thinkTokens', ['think-tokens']),
  booleanSetting('sandbox', 'sandbox'),
  numberSetting('contextWindow', 'contextWindow', ['context-window']),
  numberSetting('contextWarn', 'contextWarn', ['context-warn']),
  booleanSetting('autoCompact', 'autoCompact', ['auto-compact']),
  numberSetting('autoCompactThreshold', 'autoCompactThreshold', ['auto-compact-threshold']),
  booleanSetting('verbose', 'verbose'),
  enumSetting('logLevel', 'logLevel', LOG_LEVELS, ['log-level']),
  textSetting('sessionDir', 'sessionDir', ['session-dir']),
  textSetting('endpoint', 'endpoint'),
  optionalTextSetting('policyPath', 'policyPath', ['policy', 'policy-path']),
  booleanSetting('jsonOutput', 'jsonOutput', ['json', 'json-output']),
  booleanSetting('quiet', 'quiet'),
  booleanSetting('autoApprove', 'autoApprove', ['auto-approve']),
];

export function showSettings(): string {
  const defaults = getDefaultConfig();
  const persisted = loadRcData();
  const keyWidth = Math.max(...SETTING_DEFINITIONS.map((entry) => entry.key.length), 'setting'.length) + 2;
  const valueWidth = 18;
  const defaultWidth = 18;
  const lines = [
    theme.brand('Settings'),
    `  ${pad('setting', keyWidth)}${pad('value', valueWidth)}${pad('default', defaultWidth)}persisted`,
    `  ${theme.dim('-'.repeat(keyWidth + valueWidth + defaultWidth + 'persisted'.length))}`,
  ];

  for (const definition of SETTING_DEFINITIONS) {
    const current = formatValue(definition, config[definition.configKey]);
    const fallback = formatValue(definition, defaults[definition.configKey]);
    const stored = [definition.key, definition.configKey, ...(definition.aliases ?? [])].some((candidate) =>
      Object.prototype.hasOwnProperty.call(persisted, candidate),
    );
    lines.push(
      `  ${pad(definition.key, keyWidth)}${pad(current, valueWidth)}${pad(fallback, defaultWidth)}${stored ? theme.ok('yes') : theme.dim('no')}`,
    );
  }

  lines.push('', `  rc file: ${theme.dim(rcFilePath())}`, '');
  return lines.join('\n');
}

export function setSetting(key: string, value: string): string {
  const definition = resolveSetting(key);
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error(`value is required for setting: ${definition.key}`);
  }

  const parsed = definition.parse(trimmedValue);
  applyRuntimeSetting(definition, parsed);
  const rcData = loadRcData();
  rcData[definition.key] = toPersistedValue(parsed);
  writeRcData(rcData);
  return theme.ok(`✔ setting ${definition.key} → ${formatValue(definition, parsed)}\n`);
}

export function resetSetting(key: string): string {
  const definition = resolveSetting(key);
  const defaults = getDefaultConfig();
  applyRuntimeSetting(definition, defaults[definition.configKey]);
  const rcData = loadRcData();
  delete rcData[definition.key];
  writeRcData(rcData);
  return theme.ok(`✔ reset ${definition.key} → ${formatValue(definition, defaults[definition.configKey])}\n`);
}

export function isModelSettingKey(key: string): boolean {
  return resolveSetting(key).key === 'model';
}

function resolveSetting(key: string): SettingDefinition<any> {
  const normalized = key.trim().toLowerCase();
  const definition = SETTING_DEFINITIONS.find((entry) =>
    [entry.key, ...(entry.aliases ?? [])].some((candidate) => candidate.toLowerCase() === normalized),
  );
  if (!definition) {
    throw new Error(`unsupported setting: ${key}`);
  }
  return definition;
}

function loadRcData(): Record<string, unknown> {
  const file = rcFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function writeRcData(data: Record<string, unknown>): void {
  const file = rcFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  const sorted = Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function applyRuntimeSetting(definition: SettingDefinition<any>, value: unknown): void {
  const mutableConfig = config as unknown as Record<string, unknown>;
  mutableConfig[definition.configKey] = value;
  if (definition.key === 'sandbox') {
    if (value) process.env.ICOPILOT_SANDBOX = '1';
    else delete process.env.ICOPILOT_SANDBOX;
  }
}

function formatValue(definition: SettingDefinition<any>, value: unknown): string {
  if (value === undefined || value === null || value === '') return theme.dim('(default)');
  if (definition.format) return definition.format(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function toPersistedValue(value: unknown): unknown {
  return value === undefined ? undefined : value;
}

function parseBoolean(value: string): boolean {
  if (BOOLEAN_TRUE.test(value)) return true;
  if (BOOLEAN_FALSE.test(value)) return false;
  throw new Error(`invalid boolean: ${value}`);
}

function pad(value: string, width: number): string {
  return `${value}`.padEnd(width);
}

function textSetting(
  key: PublicSettingKey,
  configKey: ConfigKey,
  aliases: string[] = [],
): SettingDefinition<string> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => value,
  };
}

function optionalTextSetting(
  key: PublicSettingKey,
  configKey: ConfigKey,
  aliases: string[] = [],
): SettingDefinition<string | undefined> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => (/^(default|none|off)$/i.test(value) ? undefined : value),
  };
}

function booleanSetting(
  key: PublicSettingKey,
  configKey: ConfigKey,
  aliases: string[] = [],
): SettingDefinition<boolean> {
  return {
    key,
    configKey,
    aliases,
    parse: parseBoolean,
  };
}

function enumSetting<T extends string>(
  key: PublicSettingKey,
  configKey: ConfigKey,
  allowed: readonly T[],
  aliases: string[] = [],
): SettingDefinition<T> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => {
      const normalized = value.trim().toLowerCase();
      const mapped = normalized === 'no-color' ? 'none' : normalized;
      const match = allowed.find((entry) => entry === mapped);
      if (!match) {
        throw new Error(`invalid ${key}: ${value}`);
      }
      return match;
    },
  };
}

function optionalEnumSetting<T extends string>(
  key: PublicSettingKey,
  configKey: ConfigKey,
  allowed: readonly T[],
  aliases: string[] = [],
): SettingDefinition<T | undefined> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => {
      if (/^(default|none|off)$/i.test(value)) return undefined;
      return enumSetting(key, configKey, allowed, aliases).parse(value);
    },
    format: (value) => (value === undefined ? theme.dim('(default)') : String(value)),
  };
}

function numberSetting(
  key: PublicSettingKey,
  configKey: ConfigKey,
  aliases: string[] = [],
): SettingDefinition<number> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`invalid number: ${value}`);
      }
      return parsed;
    },
  };
}

function optionalNumberSetting(
  key: PublicSettingKey,
  configKey: ConfigKey,
  aliases: string[] = [],
): SettingDefinition<number | undefined> {
  return {
    key,
    configKey,
    aliases,
    parse: (value) => {
      if (/^(default|none|off)$/i.test(value)) return undefined;
      return numberSetting(key, configKey, aliases).parse(value);
    },
    format: (value) => (value === undefined ? theme.dim('(default)') : String(value)),
  };
}
