import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.hoisted(() => {
  process.env.GITHUB_TOKEN = 'test-token';
});

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: openAiMocks.create,
      },
    },
  })),
}));

async function* streamChunks(content: string) {
  yield { choices: [{ delta: { content }, finish_reason: 'stop' }] };
}

describe('streamChat backoff smoke', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    openAiMocks.create.mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  it('retries once after a 429 and returns streamed content', async () => {
    openAiMocks.create
      .mockRejectedValueOnce({ status: 429, headers: new Headers({ 'retry-after': '0' }) })
      .mockResolvedValueOnce(streamChunks('ok'));

    const { streamChat } = await import('../../src/api/github-models.js');
    const onToken = vi.fn();
    const resultPromise = streamChat({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      onToken,
    });

    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenCalledWith('ok');
    expect(result).toMatchObject({ content: 'ok', finishReason: 'stop', toolCalls: [] });
  });
});
