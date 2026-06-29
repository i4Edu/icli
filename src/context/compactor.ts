import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { streamChat } from '../api/github-models.js';
import { Session } from '../session/session.js';
import { hookManager } from '../hooks/lifecycle.js';
import { theme } from '../ui/theme.js';

const SUMMARY_PROMPT = `You are summarizing a developer/AI assistant conversation to preserve essential context while drastically reducing token usage.
Produce a structured summary with these sections (omit empty ones):
- **Goals**: what the user is trying to achieve
- **Decisions**: key choices made
- **Files touched**: paths + 1-line purpose
- **Open questions**: unresolved items
- **Next steps**: what to do next
Keep it under 400 words.`;

export async function compactSession(session: Session, signal?: AbortSignal): Promise<string> {
  await hookManager.emit('preCompact', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    messageCount: session.state.messages.length,
  });
  const history = session.state.messages
    .map((m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      return `### ${m.role}\n${c}`;
    })
    .join('\n\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: history || '(empty conversation)' },
  ];

  process.stdout.write(theme.dim('Compacting history…\n'));
  let acc = '';
  const res = await streamChat({
    model: session.state.model,
    messages,
    temperature: 0,
    signal,
    onToken: (t) => {
      acc += t;
      process.stdout.write(theme.dim(t));
    },
  });
  process.stdout.write('\n');
  const summary = res.content || acc;
  const hookResult = await hookManager.emit('postCompact', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    messageCount: session.state.messages.length,
    summary,
  });
  if (
    hookResult.action === 'modify' &&
    typeof (hookResult.modifications as any)?.summary === 'string'
  ) {
    return String((hookResult.modifications as any).summary);
  }
  return summary;
}
