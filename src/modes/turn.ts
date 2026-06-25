import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Session } from '../session/session.js';
import { streamChat } from '../api/github-models.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';
import { StreamSink } from '../ui/render.js';
import { theme } from '../ui/theme.js';
import { ASK_SYSTEM, PLAN_SYSTEM } from '../commands/prompts.js';
import { parseFileRefs, renderFileRefBlock } from '../context/file-refs.js';
import { loadMemoryBlock } from '../context/memory.js';

const MAX_TOOL_HOPS = 6;

export interface TurnOpts {
  session: Session;
  userInput: string;
  signal: AbortSignal;
}

/**
 * Run one user→assistant turn. Handles @file injection, tool-call loop,
 * streaming output, and persistent history.
 */
export async function runTurn(opts: TurnOpts): Promise<void> {
  const { session, userInput, signal } = opts;
  const refs = parseFileRefs(userInput);
  const refBlock = renderFileRefBlock(refs);

  if (refs.length) {
    process.stdout.write(
      theme.dim(
        `  injected ${refs.length} file ref${refs.length === 1 ? '' : 's'}: ` +
          refs.map((r) => r.rel).join(', ') +
          '\n',
      ),
    );
  }

  const sys: ChatCompletionMessageParam = {
    role: 'system',
    content: `${loadMemoryBlock(session.state.cwd) ?? ''}\n\n${
      session.state.mode === 'plan' ? PLAN_SYSTEM : ASK_SYSTEM
    }`.trim(),
  };

  const userMsg: ChatCompletionMessageParam = {
    role: 'user',
    content: refBlock ? `${userInput}\n\n${refBlock}` : userInput,
  };
  session.push(userMsg);

  const useTools = session.state.mode === 'ask';

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const sink = new StreamSink();
    process.stdout.write('\n' + theme.assistant('● ') + '');
    const res = await streamChat({
      model: session.state.model,
      messages: [sys, ...session.state.messages],
      tools: useTools ? TOOL_SCHEMAS : undefined,
      signal,
      onToken: (t) => sink.write(t),
    });
    sink.finalize();

    // Persist assistant message
    const assistantMsg: ChatCompletionMessageParam = {
      role: 'assistant',
      content: res.content || '',
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

    if (!res.toolCalls.length || res.finishReason === 'stop') return;

    // Execute tools and append tool results, then loop
    for (const tc of res.toolCalls) {
      let parsed: any = {};
      try {
        parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        parsed = { __raw: tc.arguments };
      }
      const out = await dispatchTool(tc.name, parsed);
      session.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: out,
      } as ChatCompletionMessageParam);
    }
  }

  process.stdout.write(theme.warn(`\n⚠  tool-call hop limit (${MAX_TOOL_HOPS}) reached.\n`));
}
