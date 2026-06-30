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
import { copilotApiHeaders, getCopilotToken } from './copilot-token.js';
import { ProxyManager } from '../security/proxy.js';
import { theme } from '../ui/theme.js';

let _client: OpenAI | null = null;
let _clientCacheKey: string | null = null;

export async function client(): Promise<OpenAI> {
  const provider = activeProvider();
  const proxyConfig = ProxyManager.shared().loadConfig();

  let apiKey = config.token || resolveProviderApiKey(provider) || 'not-needed';
  let headers = provider?.headers;

  // The Copilot API requires a short-lived token exchanged from the GitHub
  // token, plus editor identity headers — mirroring the official Copilot CLI.
  if (provider?.name === 'copilot') {
    const githubToken = config.token || resolveProviderApiKey(provider);
    if (!githubToken) {
      throw new Error(
        'Copilot provider requires a GitHub token. Set GITHUB_TOKEN or GH_TOKEN, or run ' +
          '`gh auth login` with a Copilot-enabled account.',
      );
    }
    apiKey = await getCopilotToken(githubToken);
    headers = { ...copilotApiHeaders(), ...(provider?.headers || {}) };
  }

  const cacheKey = JSON.stringify({
    provider: config.provider,
    endpoint: config.endpoint,
    token: apiKey,
    headers: headers || null,
    proxy: proxyConfig,
  });
  if (_client && _clientCacheKey === cacheKey) return _client;
  _client = new OpenAI({
    apiKey,
    baseURL: config.endpoint || provider?.baseUrl,
    defaultHeaders: headers,
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

type ChatReasoningParams = {
  max_completion_tokens?: number;
  max_tokens?: number;
  reasoning_effort?: string;
};

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
      const message = String(err?.message ?? err ?? '');
      if (status === 401 || (status === 400 && /authorization/i.test(message))) {
        throw new Error(authErrorHint(message));
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Build an actionable message for authentication failures (HTTP 401, or 400
 * responses complaining about the Authorization header). Surfaces the active
 * endpoint/provider and the most common token/endpoint mismatch fixes.
 */
function authErrorHint(detail: string): string {
  const endpoint = config.endpoint || activeProvider()?.baseUrl || '(provider default)';
  return [
    `authentication failed: ${detail}`,
    `  endpoint: ${endpoint}`,
    `  provider: ${config.provider}`,
    `Your token does not match this endpoint. Common fixes:`,
    `  • For GitHub Models, unset ICOPILOT_ENDPOINT (default: ` +
      `https://models.inference.ai.azure.com) and set GITHUB_TOKEN to a PAT with 'models:read'.`,
    `  • For the Copilot API (https://api.business.githubcopilot.com), select the 'copilot' ` +
      `provider (ICOPILOT_PROVIDER=copilot) so your GitHub token is exchanged for a Copilot token.`,
  ].join('\n');
}

async function runOnce(opts: StreamOpts): Promise<StreamResult> {
  const provider = activeProvider();
  const request: any = {
    model: opts.model,
    messages: opts.messages,
    tools: opts.tools,
    temperature: opts.temperature ?? 0.2,
    ...buildChatReasoningParams(opts.model, provider?.maxTokens),
    stream: true,
  };
  const stream = (await (
    await client()
  ).chat.completions.create(request, {
    signal: opts.signal,
  })) as unknown as AsyncIterable<ChatCompletionChunk>;

  let content = '';
  let finishReason: string | null = null;
  const toolAcc: Record<number, { id: string; name: string; arguments: string }> = {};

  for await (const chunk of stream) {
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

function buildChatReasoningParams(model: string, providerMaxTokens?: number): ChatReasoningParams {
  const params: ChatReasoningParams = {};
  if (supportsReasoningEffort(model) && config.reasoningEffort) {
    params.reasoning_effort = config.reasoningEffort;
  }
  const completionBudget = resolveCompletionBudget(model, providerMaxTokens, config.thinkTokens);
  if (completionBudget !== undefined) {
    params.max_completion_tokens = completionBudget;
    return params;
  }
  if (providerMaxTokens) {
    params.max_tokens = providerMaxTokens;
  }
  return params;
}

function resolveCompletionBudget(
  model: string,
  providerMaxTokens?: number,
  thinkTokens?: number,
): number | undefined {
  if (!supportsReasoningTokenBudget(model)) return undefined;
  const budgets = [providerMaxTokens, thinkTokens].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  if (!budgets.length) return undefined;
  return Math.min(...budgets.map((value) => Math.floor(value)));
}

function supportsReasoningEffort(model: string): boolean {
  return /^o\d/i.test(model.trim());
}

function supportsReasoningTokenBudget(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^o\d/.test(normalized) || normalized.startsWith('gpt-5');
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
