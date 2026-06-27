import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerRegistry, resolveProviderApiKey } from './providers/custom-provider.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ThemeName = 'auto' | 'light' | 'dark' | 'none';

export interface Config {
  provider: string;
  endpoint: string;
  token: string | undefined;
  defaultModel: string;
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
}

const HOME = os.homedir();

const DEFAULT_CONFIG: Config = {
  provider: 'github',
  endpoint: 'https://models.inference.ai.azure.com',
  token: undefined,
  defaultModel: 'gpt-4o-mini',
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

function normalizeConfig(raw: Record<string, unknown>): Partial<Config> {
  const out: Partial<Config> = {};
  if (typeof raw.provider === 'string') out.provider = raw.provider;
  if (typeof raw.endpoint === 'string') out.endpoint = raw.endpoint;
  if (typeof raw.token === 'string') out.token = raw.token;
  if (typeof raw.defaultModel === 'string') out.defaultModel = raw.defaultModel;
  if (typeof raw.sessionDir === 'string') out.sessionDir = raw.sessionDir;
  if (typeof raw.contextWindow === 'number') out.contextWindow = raw.contextWindow;
  if (typeof raw.contextWarn === 'number') out.contextWarn = raw.contextWarn;
  if (typeof raw.autoCompact === 'boolean') out.autoCompact = raw.autoCompact;
  if (typeof raw.autoCompactThreshold === 'number') out.autoCompactThreshold = raw.autoCompactThreshold;
  if (typeof raw.cwd === 'string') out.cwd = raw.cwd;
  if (typeof raw.verbose === 'boolean') out.verbose = raw.verbose;
  if (typeof raw.sandbox === 'boolean') out.sandbox = raw.sandbox;
  if (typeof raw.policyPath === 'string') out.policyPath = raw.policyPath;
  if (typeof raw.jsonOutput === 'boolean') out.jsonOutput = raw.jsonOutput;
  if (typeof raw.quiet === 'boolean') out.quiet = raw.quiet;
  if (typeof raw.autoApprove === 'boolean') out.autoApprove = raw.autoApprove;
  const logLevel = parseLogLevel(raw.logLevel);
  if (logLevel) out.logLevel = logLevel;
  const theme = parseTheme(raw.theme);
  if (theme) out.theme = theme;
  return out;
}

export function loadRcFile(): Partial<Config> {
  const rcPath = path.join(HOME, '.icopilotrc.json');
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
  return out;
}

function finalizeConfig(raw: Config): Config {
  const activeProvider = providerRegistry.getActive();
  const requestedProvider =
    typeof raw.provider === 'string' && raw.provider.trim()
      ? raw.provider.trim()
      : undefined;
  const provider =
    (requestedProvider &&
      (requestedProvider !== DEFAULT_CONFIG.provider || activeProvider.name === DEFAULT_CONFIG.provider)
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
      (provider.defaultModel || provider.models[0] || DEFAULT_CONFIG.defaultModel) !== DEFAULT_CONFIG.defaultModel);

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
  const provider = options.persist === false ? providerRegistry.get(name) : providerRegistry.setActive(name);
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
