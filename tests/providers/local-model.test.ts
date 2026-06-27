import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modelsListMock = vi.hoisted(() => vi.fn());
const openAIConstructorMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn((options: unknown) => {
    openAIConstructorMock(options);
    return {
      models: {
        list: modelsListMock,
      },
    };
  }),
}));

describe('LocalModelProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    modelsListMock.mockReset();
    openAIConstructorMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies provider defaults and creates an OpenAI-compatible client', async () => {
    const { LocalModelProvider } = await import('../../src/providers/local-model.js');
    const provider = new LocalModelProvider();

    const config = provider.configure({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
    });
    const client = provider.getClient();

    expect(config).toEqual({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
      apiKey: undefined,
    });
    expect(client).toBeDefined();
    expect(openAIConstructorMock).toHaveBeenCalledWith({
      apiKey: 'air-gapped-local',
      baseURL: 'http://127.0.0.1:11434/v1',
    });
  });

  it('lists models from the OpenAI-compatible /models endpoint', async () => {
    const { LocalModelProvider } = await import('../../src/providers/local-model.js');
    const provider = new LocalModelProvider();
    provider.configure({
      provider: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
    });
    modelsListMock.mockResolvedValue({
      data: [{ id: 'qwen2.5-coder' }, { id: 'mistral-nemo' }, { id: 'qwen2.5-coder' }],
    });

    await expect(provider.listModels()).resolves.toEqual(['mistral-nemo', 'qwen2.5-coder']);
  });

  it('falls back to the Ollama tags API when /models is unavailable', async () => {
    const { LocalModelProvider } = await import('../../src/providers/local-model.js');
    const provider = new LocalModelProvider();
    provider.configure({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
    });
    modelsListMock.mockRejectedValue(new Error('models.list failed'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2' }, { name: 'qwen2.5-coder' }],
      }),
    });

    await expect(provider.listModels()).resolves.toEqual(['llama3.2', 'qwen2.5-coder']);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags');
  });

  it('reports availability from discovered models', async () => {
    const { LocalModelProvider } = await import('../../src/providers/local-model.js');
    const provider = new LocalModelProvider();
    provider.configure({
      provider: 'vllm',
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'local-model',
    });
    modelsListMock.mockResolvedValue({
      data: [{ id: 'deepseek-r1-distill' }],
    });

    await expect(provider.isAvailable()).resolves.toBe(true);
  });
});
