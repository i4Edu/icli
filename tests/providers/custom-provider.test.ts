import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAIMocks = vi.hoisted(() => ({
  constructorCalls: [] as Array<Record<string, unknown>>,
  modelsList: vi.fn(),
  chatCreate: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn((options: Record<string, unknown>) => {
    openAIMocks.constructorCalls.push(options);
    return {
      models: { list: openAIMocks.modelsList },
      chat: { completions: { create: openAIMocks.chatCreate } },
    };
  }),
}));

vi.mock('node:child_process', () => ({
  execFileSync: childProcessMocks.execFileSync,
}));

const originalEnv = { ...process.env };

let tempRoot: string;
let providersPath: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.vitest-provider-registry-'));
  providersPath = path.join(tempRoot, 'providers.json');
  process.env = {
    ...originalEnv,
    ICOPILOT_DISABLE_AUTO_MAIN: '1',
    ICOPILOT_PROVIDERS_PATH: providersPath,
  };
  openAIMocks.constructorCalls.length = 0;
  openAIMocks.modelsList.mockReset();
  openAIMocks.chatCreate.mockReset();
  childProcessMocks.execFileSync.mockReset();
  vi.restoreAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ProviderRegistry', () => {
  it('loads built-ins, persists custom providers, and restores the active provider', async () => {
    const { ProviderRegistry } = await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });

    expect(registry.list().map((provider) => provider.name)).toEqual(
      expect.arrayContaining(['github', 'openai', 'anthropic']),
    );
    expect(registry.getActive().name).toBe('github');

    registry.register({
      name: 'demo',
      baseUrl: 'https://demo.example/v1/',
      models: ['demo-model', 'demo-backup'],
      defaultModel: 'demo-backup',
      headers: { 'X-Test': 'yes' },
      maxTokens: 2048,
    });
    registry.setActive('demo');

    const stored = JSON.parse(fs.readFileSync(providersPath, 'utf8')) as {
      active: string;
      providers: Array<{ name: string; baseUrl: string; defaultModel: string; maxTokens: number }>;
    };
    expect(stored.active).toBe('demo');
    expect(stored.providers).toEqual([
      expect.objectContaining({
        name: 'demo',
        baseUrl: 'https://demo.example/v1',
        defaultModel: 'demo-backup',
        maxTokens: 2048,
      }),
    ]);

    const reloaded = new ProviderRegistry({ configPath: providersPath });
    expect(reloaded.getActive().name).toBe('demo');
    expect(reloaded.get('demo')).toMatchObject({
      name: 'demo',
      baseUrl: 'https://demo.example/v1',
      defaultModel: 'demo-backup',
      headers: { 'X-Test': 'yes' },
      maxTokens: 2048,
    });
  });

  it('creates cached OpenAI clients with provider-specific credentials and headers', async () => {
    process.env.OPENAI_API_KEY = 'openai-test-key';
    const { ProviderRegistry } = await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });

    const first = registry.createClient('openai');
    const second = registry.createClient('openai');

    expect(first).toBe(second);
    expect(openAIMocks.constructorCalls).toHaveLength(1);
    expect(openAIMocks.constructorCalls[0]).toMatchObject({
      apiKey: 'openai-test-key',
      baseURL: 'https://api.openai.com/v1',
    });

    registry.register({
      name: 'proxy',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'proxy-key',
      models: ['proxy-model'],
      headers: { 'X-Proxy': 'enabled' },
    });
    registry.createClient('proxy');

    expect(openAIMocks.constructorCalls[1]).toMatchObject({
      apiKey: 'proxy-key',
      baseURL: 'https://proxy.example/v1',
      defaultHeaders: { 'X-Proxy': 'enabled' },
    });
  });

  it('falls back to gh auth token for github when env vars are absent', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.ICOPILOT_TOKEN;
    childProcessMocks.execFileSync.mockReturnValueOnce('gh-cli-token\n');

    const { ProviderRegistry, resolveProviderApiKey } =
      await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });
    const github = registry.get('github');

    expect(github).toBeDefined();
    expect(resolveProviderApiKey(github!)).toBe('gh-cli-token');
    expect(resolveProviderApiKey(github!)).toBe('gh-cli-token');
    expect(childProcessMocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.execFileSync).toHaveBeenCalledWith('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('reads GH_TOKEN for github/copilot when GITHUB_TOKEN is absent', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.ICOPILOT_TOKEN;
    process.env.GH_TOKEN = 'gh-env-token';

    const { ProviderRegistry, resolveProviderApiKey } =
      await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });

    expect(resolveProviderApiKey(registry.get('github')!)).toBe('gh-env-token');
    expect(resolveProviderApiKey(registry.get('copilot')!)).toBe('gh-env-token');
    expect(childProcessMocks.execFileSync).not.toHaveBeenCalled();

    delete process.env.GH_TOKEN;
  });

  it('tests providers through models.list and falls back to a chat completion probe', async () => {
    const { ProviderRegistry } = await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });

    openAIMocks.modelsList.mockResolvedValueOnce({
      data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1-mini' }],
    });

    await expect(registry.testProvider('github')).resolves.toEqual({
      ok: true,
      provider: 'github',
      models: ['gpt-4o-mini', 'gpt-4.1-mini'],
    });

    openAIMocks.modelsList.mockRejectedValueOnce(new Error('models unsupported'));
    openAIMocks.chatCreate.mockResolvedValueOnce({ choices: [] });

    await expect(registry.testProvider('openai')).resolves.toEqual({
      ok: true,
      provider: 'openai',
      models: ['gpt-4o-mini'],
    });
    expect(openAIMocks.chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        max_tokens: 1,
      }),
    );
  });

  it('removes only custom providers', async () => {
    const { ProviderRegistry } = await import('../../src/providers/custom-provider.js');
    const registry = new ProviderRegistry({ configPath: providersPath });

    registry.register({
      name: 'removable',
      baseUrl: 'https://removable.example/v1',
      models: ['rm-model'],
    });

    expect(registry.remove('github')).toBe(false);
    expect(registry.remove('removable')).toBe(true);
    expect(registry.get('removable')).toBeUndefined();
  });
});

describe('config and CLI wiring', () => {
  it('loads the active provider into config', async () => {
    fs.writeFileSync(
      providersPath,
      JSON.stringify(
        {
          active: 'workspace-proxy',
          providers: [
            {
              name: 'workspace-proxy',
              baseUrl: 'https://workspace.example/v1',
              models: ['workspace-model'],
              defaultModel: 'workspace-model',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const { config } = await import('../../src/config.js');

    expect(config.provider).toBe('workspace-proxy');
    expect(config.endpoint).toBe('https://workspace.example/v1');
    expect(config.defaultModel).toBe('workspace-model');
  }, 20_000);

  it('applies --provider and --base-url flags', async () => {
    process.env.OPENAI_API_KEY = 'openai-cli-key';
    const indexSource = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf8');
    const { config, setProvider } = await import('../../src/config.js');

    expect(indexSource).toContain("'--provider <name>'");
    expect(indexSource).toContain(".option('--base-url <url>'");

    setProvider('openai', { persist: false });
    config.endpoint = 'https://gateway.example/v1';

    expect(config.provider).toBe('openai');
    expect(config.endpoint).toBe('https://gateway.example/v1');
    expect(config.defaultModel).toBe('gpt-4o-mini');
    expect(config.token).toBe('openai-cli-key');
  }, 20_000);
});
