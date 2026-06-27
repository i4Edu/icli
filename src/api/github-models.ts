import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { config } from '../config.js';
import {
  providerRegistry,
  resolveProviderApiKey,
  type ProviderConfig,
} from '../providers/custom-provider.js';
import { ProxyManager } from '../security/proxy.js';
import { theme } from '../ui/theme.js';

let _client: OpenAI | null = null;
let _clientCacheKey: string | null = null;

export function client(): OpenAI {
  const provider = activeProvider();
  const proxyConfig = ProxyManager.shared().loadConfig();
  const cacheKey = JSON.stringify({
    provider: config.provider,
    endpoint: config.endpoint,
    token: config.token || resolveProviderApiKey(provider) || 'not-needed',
    headers: provider?.headers || null,
    proxy: proxyConfig,
  });
  if (_client && _clientCacheKey === cacheKey) return _client;
  _client = new OpenAI({
    apiKey: config.token || resolveProviderApiKey(provider) || 'not-needed',
    baseURL: config.endpoint || provider?.baseUrl,
    defaultHeaders: provider?.headers,
    httpAgent: ProxyManager.shared().getAgent(),
  });
  _clientCacheKey = cacheKey;
  return _client;
}

export function activeProvider(): ProviderConfig {
  return providerRegistry.get(config.provider) || providerRegistry.getActive();
}

export interface StreamOpts {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  temperature?: number;
  signal?: AbortSignal;
  onToken: (delta: string) => void;
}

export interface StreamResult {
  content: string;
  toolCalls: {
    id: string;
    name: string;
    arguments: string;
  }[];
  finishReason: string | null;
}

/**
 * Stream a chat completion from GitHub Models, with exponential backoff
 * on HTTP 429. Supports tool/function calling.
 */
export async function streamChat(opts: StreamOpts): Promise<StreamResult> {
  const maxAttempts = 5;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    try {
      return await runOnce(opts);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;

      if (status === 429) {
        const retryAfter = Number(
          err?.headers?.get?.('retry-after') || err?.response?.headers?.['retry-after'] || 0,
        );
        const wait = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1500;
        process.stderr.write(
          theme.warn(
            `\n⚠  Rate limit (429). Cooling down ${Math.ceil(wait / 1000)}s ` +
              `(attempt ${attempt + 1}/${maxAttempts})…\n`,
          ),
        );
        await sleep(wait, opts.signal);
        attempt++;
        continue;
      }
      if (status && status >= 500 && status < 600 && attempt < maxAttempts - 1) {
        const wait = 2 ** attempt * 1000;
        process.stderr.write(theme.warn(`\n⚠  Upstream ${status}; retrying in ${wait}ms…\n`));
        await sleep(wait, opts.signal);
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function runOnce(opts: StreamOpts): Promise<StreamResult> {
  const provider = activeProvider();
  const stream = await client().chat.completions.create(
    {
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      temperature: opts.temperature ?? 0.2,
      ...(provider?.maxTokens ? { max_tokens: provider.maxTokens } : {}),
      stream: true,
    },
    { signal: opts.signal },
  );

  let content = '';
  let finishReason: string | null = null;
  const toolAcc: Record<number, { id: string; name: string; arguments: string }> = {};

  for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta: any = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content.length) {
      content += delta.content;
      opts.onToken(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolAcc[idx] || (toolAcc[idx] = { id: '', name: '', arguments: '' });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return {
    content,
    toolCalls: Object.values(toolAcc).filter((t) => t.name),
    finishReason,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
