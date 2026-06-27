import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Session } from '../session/session.js';
import { streamChat } from '../api/github-models.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';
import { StreamSink } from '../ui/render.js';
import { theme } from '../ui/theme.js';
import { ASK_SYSTEM, PLAN_SYSTEM } from '../commands/prompts.js';
import { parseFileRefs, renderFileRefBlock } from '../context/file-refs.js';
import { renderGitContextBlock } from '../context/git-context.js';
import { loadMemoryBlock } from '../context/memory.js';
import { PinnedContext } from '../context/pinned.js';
import { loadCorrectionPromptContext } from '../knowledge/corrections.js';
import { loadConventionPromptContext } from '../knowledge/conventions.js';
import { loadStylePromptContext } from '../knowledge/style-learner.js';
import type { MetricsCollector } from '../commands/metrics-cmd.js';
import { config } from '../config.js';
import { loadProjectContentFilter, summarizeFilterResult } from '../security/content-filter.js';
import { countTokensSync } from '../util/tokens.js';

const MAX_TOOL_HOPS = 6;

export interface TurnOpts {
  session: Session;
  userInput: string;
  metrics?: MetricsCollector;
  signal: AbortSignal;
}

/**
 * Run one user→assistant turn. Handles @file injection, tool-call loop,
 * streaming output, and persistent history.
 */
export async function runTurn(opts: TurnOpts): Promise<void> {
  const { session, userInput, metrics, signal } = opts;
  const turnStartedAt = Date.now();
  let assistantTokens = 0;
  const refs = parseFileRefs(userInput);
  const refBlock = renderFileRefBlock(refs);
  const promptInput = refBlock ? `${userInput}\n\n${refBlock}` : userInput;
  const filterResult = loadProjectContentFilter(session.state.cwd).filter(promptInput);

  if (refs.length && !config.quiet && !config.jsonOutput) {
    process.stdout.write(
      theme.dim(
        `  injected ${refs.length} file ref${refs.length === 1 ? '' : 's'}: ` +
          refs.map((r) => r.rel).join(', ') +
          '\n',
      ),
    );
  }

  if (filterResult.blocked) {
    const blockedRules = [
      ...new Set(
        filterResult.matches
          .filter((match) => match.action === 'block')
          .map((match) => match.name),
      ),
    ];
    throw new Error(
      `prompt blocked by content filter (${summarizeFilterResult(filterResult)}): ${blockedRules.join(', ')}`,
    );
  }

  if ((filterResult.changed || filterResult.warnings > 0) && !config.quiet && !config.jsonOutput) {
    process.stdout.write(theme.warn(`  content filter applied: ${summarizeFilterResult(filterResult)}\n`));
  }

  const sys: ChatCompletionMessageParam = {
    role: 'system',
    content: buildSystemPrompt(session, filterResult.filtered),
  };

  const userMsg: ChatCompletionMessageParam = {
    role: 'user',
    content: filterResult.filtered,
  };
  session.push(userMsg);

  const useTools = session.state.mode === 'ask';

  try {
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const sink = new StreamSink();
      if (!config.quiet && !config.jsonOutput) {
        process.stdout.write('\n' + theme.assistant('● ') + '');
      }
      const res = await streamChat({
        model: session.state.model,
        messages: [sys, ...session.state.messages],
        tools: useTools ? TOOL_SCHEMAS : undefined,
        signal,
        onToken: (t) => {
          if (!config.jsonOutput) sink.write(t);
        },
      });
      if (!config.jsonOutput) {
        sink.finalize();
      }
      const content = res.content || '';
      const tokenCount = safeTokenCount(content);
      assistantTokens += tokenCount;

      // Persist assistant message
      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content,
        ...(res.toolCalls.length
          ? {
              tool_calls: res.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments || '{}' },
              })),
            }
          : {}),
      };
      session.push(assistantMsg);

      if (config.jsonOutput) {
        process.stdout.write(
          JSON.stringify({
            role: 'assistant',
            content,
            model: session.state.model,
            tokens: tokenCount,
          }) + '\n',
        );
      }

      if (!res.toolCalls.length || res.finishReason === 'stop') return;

      // Execute tools and append tool results, then loop
      for (const tc of res.toolCalls) {
        let parsed: any = {};
        try {
          parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          parsed = { __raw: tc.arguments };
        }
        const toolStartedAt = Date.now();
        const out = await dispatchTool(tc.name, parsed);
        metrics?.recordToolCall(tc.name, Date.now() - toolStartedAt);
        session.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: out,
        } as ChatCompletionMessageParam);
      }
    }
  } finally {
    if (!signal.aborted && assistantTokens > 0) {
      const durationMs = Date.now() - turnStartedAt;
      metrics?.recordResponseTime(durationMs);
      if (durationMs > 0) {
        metrics?.recordTokenThroughput(assistantTokens / (durationMs / 1000));
      }
    }
  }

  if (!config.jsonOutput) {
    process.stdout.write(theme.warn(`\n⚠  tool-call hop limit (${MAX_TOOL_HOPS}) reached.\n`));
  }
}

export function buildSystemPrompt(session: Session, context = ''): string {
  const pinnedBlock = PinnedContext.fromJSON(session.state.pinned).render();
  const gitBlock = renderGitContextBlock(session.state.gitContext ?? []);
  const styleBlock = loadStylePromptContext(session.state.cwd) ?? '';
  const conventionBlock = loadConventionPromptContext(session.state.cwd) ?? '';
  const correctionsBlock = loadCorrectionPromptContext(context) ?? '';
  const basePrompt = session.state.systemPrompt ?? (session.state.mode === 'plan' ? PLAN_SYSTEM : ASK_SYSTEM);
  return [loadMemoryBlock(session.state.cwd) ?? '', basePrompt, correctionsBlock, styleBlock, conventionBlock, pinnedBlock, gitBlock]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

function safeTokenCount(text: string): number {
  try {
    return countTokensSync(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}
