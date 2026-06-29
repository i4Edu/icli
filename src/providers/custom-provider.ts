import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { LOCAL_PROVIDER_DEFAULTS } from './local-model.js';

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  defaultModel?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
}

interface ProviderStore {
  active?: string;
  providers?: ProviderConfig[];
}

export interface ProviderTestResult {
  ok: boolean;
  provider: string;
  models: string[];
  error?: string;
}

const DEFAULT_PROVIDER_NAME = 'github';
let cachedGithubCliToken: string | null | undefined;

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    name: 'github',
    baseUrl: 'https://models.inference.ai.azure.com',
    models: [
      'gpt-4o-mini',
      'gpt-4.1-mini',
      'gpt-4.1',
      'o4-mini',
      'claude-3.5-sonnet',
      'Llama-3.3-70B-Instruct',
    ],
    defaultModel: 'gpt-4o-mini',
  },
  {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    defaultModel: 'gpt-4o-mini',
  },
  {
    name: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest'],
    defaultModel: 'claude-3-5-haiku-latest',
  },
  {
    name: 'ollama',
    baseUrl: LOCAL_PROVIDER_DEFAULTS.ollama.baseUrl,
    models: [LOCAL_PROVIDER_DEFAULTS.ollama.model],
    defaultModel: LOCAL_PROVIDER_DEFAULTS.ollama.model,
  },
  {
    name: 'vllm',
    baseUrl: LOCAL_PROVIDER_DEFAULTS.vllm.baseUrl,
    models: [LOCAL_PROVIDER_DEFAULTS.vllm.model],
    defaultModel: LOCAL_PROVIDER_DEFAULTS.vllm.model,
  },
  {
    name: 'lmstudio',
    baseUrl: LOCAL_PROVIDER_DEFAULTS.lmstudio.baseUrl,
    models: [LOCAL_PROVIDER_DEFAULTS.lmstudio.model],
    defaultModel: LOCAL_PROVIDER_DEFAULTS.lmstudio.model,
  },
];

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const normalized = Object.fromEntries(
    Object.entries(headers)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      )
      .map(([key, value]) => [key.trim(), value]),
  );
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const name = normalizeName(config.name);
  const baseUrl = trimTrailingSlash(config.baseUrl);
  const models = normalizeModels(config.models);
  if (!name) throw new Error('provider name is required');
  if (!baseUrl) throw new Error(`provider ${name} is missing a baseUrl`);
  if (!models.length) throw new Error(`provider ${name} must define at least one model`);

  const defaultModel =
    config.defaultModel && models.includes(config.defaultModel) ? config.defaultModel : models[0];
  const maxTokens =
    typeof config.maxTokens === 'number' &&
    Number.isFinite(config.maxTokens) &&
    config.maxTokens > 0
      ? Math.floor(config.maxTokens)
      : undefined;

  return {
    name,
    baseUrl,
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey : undefined,
    models,
    defaultModel,
    headers: normalizeHeaders(config.headers),
    maxTokens,
  };
}

export function providerConfigPath(): string {
  return (
    process.env.ICOPILOT_PROVIDERS_PATH || path.join(os.homedir(), '.icopilot', 'providers.json')
  );
}

function resolveGitHubCliToken(): string | undefined {
  if (cachedGithubCliToken !== undefined) return cachedGithubCliToken || undefined;
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cachedGithubCliToken = token || null;
    return cachedGithubCliToken || undefined;
  } catch {
    cachedGithubCliToken = null;
    return undefined;
  }
}

export function resolveProviderApiKey(provider: ProviderConfig): string | undefined {
  if (provider.apiKey) return provider.apiKey;
  switch (provider.name) {
    case 'github':
      return process.env.GITHUB_TOKEN || process.env.ICOPILOT_TOKEN || resolveGitHubCliToken();
    case 'openai':
      return process.env.OPENAI_API_KEY || process.env.ICOPILOT_TOKEN;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || process.env.ICOPILOT_TOKEN;
    case 'ollama':
    case 'vllm':
    case 'lmstudio':
      return process.env.ICOPILOT_LOCAL_API_KEY || process.env.ICOPILOT_TOKEN;
    default:
      return process.env.ICOPILOT_TOKEN;
  }
}

export class ProviderRegistry {
  private readonly configPath: string;
  private readonly builtIns = new Map<string, ProviderConfig>();
  private readonly customProviders = new Map<string, ProviderConfig>();
  private readonly clientCache = new Map<string, OpenAI>();
  private readonly openAIClient: typeof OpenAI;
  private activeName = DEFAULT_PROVIDER_NAME;

  constructor(
    options: {
      configPath?: string;
      builtIns?: ProviderConfig[];
      openAIClient?: typeof OpenAI;
    } = {},
  ) {
    this.configPath = options.configPath || providerConfigPath();
    this.openAIClient = options.openAIClient || OpenAI;
    for (const provider of options.builtIns || BUILTIN_PROVIDERS) {
      const normalized = normalizeProviderConfig(provider);
      this.builtIns.set(normalized.name, normalized);
    }
    this.load();
  }

  register(config: ProviderConfig): ProviderConfig {
    const normalized = normalizeProviderConfig(config);
    if (this.builtIns.has(normalized.name)) {
      throw new Error(`cannot override built-in provider: ${normalized.name}`);
    }
    this.customProviders.set(normalized.name, normalized);
    this.clearClientCache(normalized.name);
    this.save();
    return normalized;
  }

  remove(name: string): boolean {
    const normalizedName = normalizeName(name);
    if (this.builtIns.has(normalizedName)) return false;
    const deleted = this.customProviders.delete(normalizedName);
    if (!deleted) return false;
    if (this.activeName === normalizedName) this.activeName = DEFAULT_PROVIDER_NAME;
    this.clearClientCache(normalizedName);
    this.save();
    return true;
  }

  get(name: string): ProviderConfig | undefined {
    const normalizedName = normalizeName(name);
    return this.customProviders.get(normalizedName) || this.builtIns.get(normalizedName);
  }

  list(): ProviderConfig[] {
    return [...this.builtIns.values(), ...this.customProviders.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  getActive(): ProviderConfig {
    return this.get(this.activeName) || this.get(DEFAULT_PROVIDER_NAME)!;
  }

  setActive(name: string): ProviderConfig {
    const provider = this.get(name);
    if (!provider) throw new Error(`unknown provider: ${name}`);
    this.activeName = provider.name;
    this.save();
    return provider;
  }

  createClient(name?: string): OpenAI {
    const provider = name ? this.get(name) : this.getActive();
    if (!provider) throw new Error(`unknown provider: ${name}`);
    const apiKey = resolveProviderApiKey(provider) || 'not-needed';
    const cacheKey = JSON.stringify({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      headers: provider.headers || null,
    });
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    const client = new this.openAIClient({
      apiKey,
      baseURL: provider.baseUrl,
      defaultHeaders: provider.headers,
    });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  async testProvider(name: string): Promise<ProviderTestResult> {
    const provider = this.get(name);
    if (!provider) throw new Error(`unknown provider: ${name}`);

    const client = this.createClient(provider.name);
    try {
      const models = await client.models.list();
      const modelIds = models.data.map((model) => model.id).filter(Boolean);
      return { ok: true, provider: provider.name, models: modelIds };
    } catch (modelError) {
      const fallbackModel = provider.defaultModel || provider.models[0];
      if (!fallbackModel) {
        return {
          ok: false,
          provider: provider.name,
          models: [],
          error: stringifyError(modelError),
        };
      }

      try {
        await client.chat.completions.create({
          model: fallbackModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        });
        return { ok: true, provider: provider.name, models: [fallbackModel] };
      } catch (chatError) {
        return {
          ok: false,
          provider: provider.name,
          models: [],
          error: stringifyError(chatError),
        };
      }
    }
  }

  private clearClientCache(name: string): void {
    for (const key of this.clientCache.keys()) {
      if (key.includes(`"name":"${name}"`)) {
        this.clientCache.delete(key);
      }
    }
  }

  private load(): void {
    if (!fs.existsSync(this.configPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as ProviderStore;
      const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
      this.customProviders.clear();
      for (const provider of providers) {
        try {
          const normalized = normalizeProviderConfig(provider);
          if (!this.builtIns.has(normalized.name)) {
            this.customProviders.set(normalized.name, normalized);
          }
        } catch {
          // Ignore invalid provider entries and keep loading the rest.
        }
      }
      const active =
        typeof parsed.active === 'string' ? normalizeName(parsed.active) : DEFAULT_PROVIDER_NAME;
      this.activeName = this.get(active)?.name || DEFAULT_PROVIDER_NAME;
    } catch {
      this.customProviders.clear();
      this.activeName = DEFAULT_PROVIDER_NAME;
    }
  }

  private save(): void {
    const data: ProviderStore = {
      active: this.activeName,
      providers: [...this.customProviders.values()],
    };
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const providerRegistry = new ProviderRegistry();
