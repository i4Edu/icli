import OpenAI from 'openai';

export type LocalProviderName = 'ollama' | 'vllm' | 'lmstudio' | 'custom';

export interface LocalModelConfig {
  provider: LocalProviderName;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

type ProviderDefaults = Pick<LocalModelConfig, 'baseUrl' | 'model'>;

const DEFAULT_API_KEY = 'air-gapped-local';

export const LOCAL_PROVIDER_DEFAULTS: Record<LocalProviderName, ProviderDefaults> = {
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
  },
  vllm: {
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'local-model',
  },
  lmstudio: {
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
  },
  custom: {
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'local-model',
  },
};

export function isLocalProviderName(value: string): value is LocalProviderName {
  return value === 'ollama' || value === 'vllm' || value === 'lmstudio' || value === 'custom';
}

export function resolveLocalModelConfig(
  provider: LocalProviderName,
  overrides: Partial<Omit<LocalModelConfig, 'provider'>> = {},
): LocalModelConfig {
  const defaults = LOCAL_PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: normalizeBaseUrl(overrides.baseUrl ?? defaults.baseUrl),
    model: overrides.model?.trim() || defaults.model,
    apiKey: overrides.apiKey?.trim() || undefined,
  };
}

export class LocalModelProvider {
  private current: LocalModelConfig | null = null;
  private currentKey = '';
  private currentClient: OpenAI | null = null;

  configure(config: LocalModelConfig): LocalModelConfig {
    const normalized = resolveLocalModelConfig(config.provider, config);
    const nextKey = JSON.stringify(normalized);
    if (!this.currentClient || this.currentKey !== nextKey) {
      this.currentClient = new OpenAI({
        apiKey: normalized.apiKey || DEFAULT_API_KEY,
        baseURL: normalized.baseUrl,
      });
      this.currentKey = nextKey;
    }
    this.current = normalized;
    return normalized;
  }

  getConfig(): LocalModelConfig | null {
    return this.current ? { ...this.current } : null;
  }

  getClient(): OpenAI {
    if (!this.current) {
      throw new Error('Local model provider is not configured.');
    }
    if (!this.currentClient) {
      this.configure(this.current);
    }
    return this.currentClient as OpenAI;
  }

  async isAvailable(): Promise<boolean> {
    try {
      if ((await this.listModels()).length > 0) {
        return true;
      }
      const cfg = this.requireConfig();
      const response = await fetch(stripV1Suffix(cfg.baseUrl), { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const cfg = this.requireConfig();

    try {
      const response = await this.getClient().models.list();
      const ids = response.data
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
      if (ids.length > 0) {
        return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
      }
    } catch {
      // fall through to provider-specific probing
    }

    if (cfg.provider === 'ollama') {
      try {
        const response = await fetch(`${stripV1Suffix(cfg.baseUrl)}/api/tags`);
        if (response.ok) {
          const payload = (await response.json()) as { models?: Array<{ name?: string }> };
          const ids = (payload.models ?? [])
            .map((entry) => entry.name)
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
          if (ids.length > 0) {
            return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
          }
        }
      } catch {
        // ignore and fall through
      }
    }

    return [];
  }

  private requireConfig(): LocalModelConfig {
    if (!this.current) {
      throw new Error('Local model provider is not configured.');
    }
    return this.current;
  }
}

export const localModelProvider = new LocalModelProvider();

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function stripV1Suffix(value: string): string {
  return normalizeBaseUrl(value).replace(/\/v1$/i, '');
}
