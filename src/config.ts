import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Load .env for normal runs, but skip it under the test runner so a developer's
// local .env (e.g. ICOPILOT_ENDPOINT) cannot leak into and break the test suite.
if (!process.env.VITEST) {
  loadDotenv();
}
import { providerRegistry, resolveProviderApiKey } from './providers/custom-provider.js';
import type { KeybindingMode } from './util/keybindings.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ThemeName = 'auto' | 'light' | 'dark' | 'none';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

export interface NotificationConfig {
  provider: 'slack' | 'teams';
  token: string;
  channel: string;
  autoApprove?: string[];
}

export interface CloudRoutinesConfig {
  enabled: boolean;
  pollingInterval?: number;
}

export interface AcpConfig {
  enabled: boolean;
  port?: number;
}

export interface Config {
  provider: string;
  endpoint: string;
  token: string | undefined;
  defaultModel: string;
  editFormat: 'whole' | 'diff';
  autoLint: boolean;
  autoTest: boolean;
  sessionDir: string;
  // Conservative cap; real ceiling depends on selected model.
  contextWindow: number;
  // Soft warning threshold (fraction).
  contextWarn: number;
  autoCompact: boolean;
  autoCompactThreshold: number;
  cwd: string;
  verbose: boolean;
  logLevel: LogLevel;
  sandbox: boolean;
  policyPath: string | undefined;
  theme: ThemeName;
  jsonOutput: boolean;
  quiet: boolean;
  autoApprove: boolean;
  autoFix: boolean;
  lintCmd: string;
  testCmd: string;
  reasoningEffort?: ReasoningEffort;
  thinkTokens?: number;
  maxTokens?: number;
  timeout?: number;
  keybindings?: { mode: KeybindingMode };
  notifications?: NotificationConfig;
  cloudRoutines?: CloudRoutinesConfig;
  acp?: AcpConfig;
}

const HOME = os.homedir();

const DEFAULT_CONFIG: Config = {
  provider: 'github',
  endpoint: 'https://models.inference.ai.azure.com',
  token: undefined,
  defaultModel: 'gpt-4o-mini',
  editFormat: 'diff',
  autoLint: false,
  autoTest: false,
  sessionDir: path.join(HOME, '.terminal-copilot', 'sessions'),
  contextWindow: 120_000,
  contextWarn: 0.75,
  autoCompact: true,
  autoCompactThreshold: 0.95,
  cwd: process.cwd(),
  verbose: false,
  logLevel: 'info',
  sandbox: false,
  policyPath: undefined,
  theme: 'auto',
  jsonOutput: false,
  quiet: false,
  autoApprove: false,
  autoFix: true,
  lintCmd: '',
  testCmd: '',
  reasoningEffort: undefined,
  thinkTokens: undefined,
  maxTokens: undefined,
  timeout: undefined,
  keybindings: { mode: 'default' },
  acp: { enabled: false, port: 5173 },
  cloudRoutines: { enabled: false },
};

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return undefined;
}

function parseLogLevel(value: unknown): LogLevel | undefined {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : undefined;
}

function parseTheme(value: unknown): ThemeName | undefined {
  return value === 'auto' || value === 'light' || value === 'dark' || value === 'none'
    ? value
    : undefined;
}

function parseEditFormat(value: unknown): Config['editFormat'] | undefined {
  return value === 'whole' || value === 'diff' ? value : undefined;
}

function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : undefined;
}

function parseThinkTokens(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const suffix = match[2].toLowerCase();
  const multiplier = suffix === 'k' ? 1024 : suffix === 'm' ? 1024 * 1024 : 1;
  return Math.round(amount * multiplier);
}

function normalizeConfig(raw: Record<string, unknown>): Partial<Config> {
  const out: Partial<Config> = {};
  if (typeof raw.provider === 'string') out.provider = raw.provider;
  if (typeof raw.endpoint === 'string') out.endpoint = raw.endpoint;
  if (typeof raw.token === 'string') out.token = raw.token;
  if (typeof raw.defaultModel === 'string') out.defaultModel = raw.defaultModel;
  if (typeof raw.model === 'string') out.defaultModel = raw.model;
  const editFormat = parseEditFormat(raw.editFormat);
  if (editFormat) out.editFormat = editFormat;
  if (typeof raw.autoLint === 'boolean') out.autoLint = raw.autoLint;
  if (typeof raw.autoTest === 'boolean') out.autoTest = raw.autoTest;
  if (typeof raw.sessionDir === 'string') out.sessionDir = raw.sessionDir;
  if (typeof raw.contextWindow === 'number') out.contextWindow = raw.contextWindow;
  if (typeof raw.contextWarn === 'number') out.contextWarn = raw.contextWarn;
  if (typeof raw.autoCompact === 'boolean') out.autoCompact = raw.autoCompact;
  if (typeof raw.autoCompactThreshold === 'number')
    out.autoCompactThreshold = raw.autoCompactThreshold;
  if (typeof raw.cwd === 'string') out.cwd = raw.cwd;
  if (typeof raw.verbose === 'boolean') out.verbose = raw.verbose;
  if (typeof raw.sandbox === 'boolean') out.sandbox = raw.sandbox;
  if (typeof raw.policyPath === 'string') out.policyPath = raw.policyPath;
  if (typeof raw.jsonOutput === 'boolean') out.jsonOutput = raw.jsonOutput;
  if (typeof raw.quiet === 'boolean') out.quiet = raw.quiet;
  if (typeof raw.autoApprove === 'boolean') out.autoApprove = raw.autoApprove;
  if (typeof raw.autoFix === 'boolean') out.autoFix = raw.autoFix;
  if (typeof raw.lintCmd === 'string') out.lintCmd = raw.lintCmd;
  if (typeof raw.testCmd === 'string') out.testCmd = raw.testCmd;
  const logLevel = parseLogLevel(raw.logLevel);
  if (logLevel) out.logLevel = logLevel;
  const theme = parseTheme(raw.theme);
  if (theme) out.theme = theme;
  const reasoningEffort = parseReasoningEffort(raw.reasoningEffort);
  if (reasoningEffort) out.reasoningEffort = reasoningEffort;
  const thinkTokens = parseThinkTokens(raw.thinkTokens);
  if (thinkTokens !== undefined) out.thinkTokens = thinkTokens;
  return out;
}

export function rcFilePath(): string {
  const configured = process.env.ICOPILOT_RC_PATH || path.join(HOME, '.icopilotrc.json');
  if (configured === '~') return os.homedir();
  if (/^~[\\/]/.test(configured)) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

export function loadRcFile(): Partial<Config> {
  const rcPath = rcFilePath();
  try {
    if (!fs.existsSync(rcPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return normalizeConfig(parsed as Record<string, unknown>);
  } catch (err: any) {
    if (process.env.ICOPILOT_LOG_LEVEL === 'debug' || parseBool(process.env.ICOPILOT_VERBOSE)) {
      process.stderr.write(`debug: failed to load ${rcPath}: ${err?.message || err}\n`);
    }
    return {};
  }
}

function envConfig(): Partial<Config> {
  const out: Partial<Config> = {};
  if (process.env.ICOPILOT_PROVIDER) out.provider = process.env.ICOPILOT_PROVIDER;
  if (process.env.ICOPILOT_ENDPOINT) out.endpoint = process.env.ICOPILOT_ENDPOINT;
  if (process.env.ICOPILOT_TOKEN) out.token = process.env.ICOPILOT_TOKEN;
  if (process.env.ICOPILOT_MODEL) out.defaultModel = process.env.ICOPILOT_MODEL;
  const editFormat = parseEditFormat(process.env.ICOPILOT_EDIT_FORMAT);
  if (editFormat) out.editFormat = editFormat;
  const autoLint = parseBool(process.env.ICOPILOT_AUTO_LINT);
  if (autoLint !== undefined) out.autoLint = autoLint;
  const autoTest = parseBool(process.env.ICOPILOT_AUTO_TEST);
  if (autoTest !== undefined) out.autoTest = autoTest;
  if (process.env.ICOPILOT_SESSION_DIR) out.sessionDir = process.env.ICOPILOT_SESSION_DIR;
  if (process.env.ICOPILOT_CTX_WINDOW) out.contextWindow = Number(process.env.ICOPILOT_CTX_WINDOW);
  const autoCompact = parseBool(process.env.ICOPILOT_AUTO_COMPACT);
  if (autoCompact !== undefined) out.autoCompact = autoCompact;
  if (process.env.ICOPILOT_AUTO_COMPACT_THRESHOLD) {
    out.autoCompactThreshold = Number(process.env.ICOPILOT_AUTO_COMPACT_THRESHOLD);
  }
  const verbose = parseBool(process.env.ICOPILOT_VERBOSE);
  if (verbose !== undefined) out.verbose = verbose;
  const logLevel = parseLogLevel(process.env.ICOPILOT_LOG_LEVEL);
  if (logLevel) out.logLevel = logLevel;
  const sandbox = parseBool(process.env.ICOPILOT_SANDBOX);
  if (sandbox !== undefined) out.sandbox = sandbox;
  if (process.env.ICOPILOT_POLICY) out.policyPath = process.env.ICOPILOT_POLICY;
  const theme = parseTheme(process.env.ICOPILOT_THEME);
  if (theme) out.theme = theme;
  const jsonOutput = parseBool(process.env.ICOPILOT_JSON);
  if (jsonOutput !== undefined) out.jsonOutput = jsonOutput;
  const quiet = parseBool(process.env.ICOPILOT_QUIET);
  if (quiet !== undefined) out.quiet = quiet;
  const autoApprove = parseBool(process.env.ICOPILOT_AUTO_APPROVE);
  if (autoApprove !== undefined) out.autoApprove = autoApprove;
  const autoFix = parseBool(process.env.ICOPILOT_AUTO_FIX);
  if (autoFix !== undefined) out.autoFix = autoFix;
  if (process.env.ICOPILOT_LINT_CMD) out.lintCmd = process.env.ICOPILOT_LINT_CMD;
  if (process.env.ICOPILOT_TEST_CMD) out.testCmd = process.env.ICOPILOT_TEST_CMD;
  const reasoningEffort = parseReasoningEffort(process.env.ICOPILOT_REASONING_EFFORT);
  if (reasoningEffort) out.reasoningEffort = reasoningEffort;
  const thinkTokens = parseThinkTokens(process.env.ICOPILOT_THINK_TOKENS);
  if (thinkTokens !== undefined) out.thinkTokens = thinkTokens;
  // ICOPILOT_MAX_TOKENS: cap on tokens generated per response.
  if (process.env.ICOPILOT_MAX_TOKENS) {
    const maxTokens = Number(process.env.ICOPILOT_MAX_TOKENS);
    if (Number.isFinite(maxTokens) && maxTokens > 0) out.maxTokens = Math.floor(maxTokens);
  }
  // ICOPILOT_CONTEXT_TOKENS: alias for ICOPILOT_CTX_WINDOW (context window size).
  if (process.env.ICOPILOT_CONTEXT_TOKENS && !process.env.ICOPILOT_CTX_WINDOW) {
    const contextTokens = Number(process.env.ICOPILOT_CONTEXT_TOKENS);
    if (Number.isFinite(contextTokens) && contextTokens > 0)
      out.contextWindow = Math.floor(contextTokens);
  }
  // ICOPILOT_TIMEOUT: request timeout in seconds.
  if (process.env.ICOPILOT_TIMEOUT) {
    const timeoutSec = Number(process.env.ICOPILOT_TIMEOUT);
    if (Number.isFinite(timeoutSec) && timeoutSec > 0) out.timeout = timeoutSec;
  }
  return out;
}

function finalizeConfig(raw: Config): Config {
  const activeProvider = providerRegistry.getActive();
  const requestedProvider =
    typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider.trim() : undefined;
  const provider =
    (requestedProvider &&
    (requestedProvider !== DEFAULT_CONFIG.provider ||
      activeProvider.name === DEFAULT_CONFIG.provider)
      ? providerRegistry.get(requestedProvider)
      : undefined) ||
    activeProvider ||
    providerRegistry.get('github');
  if (!provider) return raw;
  const useProviderEndpoint =
    !raw.endpoint ||
    (raw.endpoint === DEFAULT_CONFIG.endpoint && provider.baseUrl !== DEFAULT_CONFIG.endpoint);
  const useProviderModel =
    !raw.defaultModel ||
    (raw.defaultModel === DEFAULT_CONFIG.defaultModel &&
      (provider.defaultModel || provider.models[0] || DEFAULT_CONFIG.defaultModel) !==
        DEFAULT_CONFIG.defaultModel);

  return {
    ...raw,
    provider: provider.name,
    endpoint: useProviderEndpoint ? provider.baseUrl : raw.endpoint,
    token: raw.token || resolveProviderApiKey(provider),
    defaultModel: useProviderModel
      ? provider.defaultModel || provider.models[0] || DEFAULT_CONFIG.defaultModel
      : raw.defaultModel,
  };
}

export const config: Config = finalizeConfig({
  ...DEFAULT_CONFIG,
  ...loadRcFile(),
  ...envConfig(),
});

export function setProvider(name: string, options: { persist?: boolean } = {}): void {
  const provider =
    options.persist === false ? providerRegistry.get(name) : providerRegistry.setActive(name);
  if (!provider) {
    throw new Error(`unknown provider: ${name}`);
  }
  config.provider = provider.name;
  config.endpoint = provider.baseUrl;
  config.token = resolveProviderApiKey(provider) || config.token;
  if (provider.defaultModel) config.defaultModel = provider.defaultModel;
}

export function requireToken(): string {
  return config.token || 'not-needed';
}
