import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { streamChat } from '../api/github-models.js';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

const SUGGEST_SYSTEM_PROMPT = `You translate natural-language requests into exactly one shell command.
Respond with ONLY the command text.
Do not explain anything.
Do not use markdown fences.
Do not add bullets, labels, or commentary.
Prefer a safe, direct command that can run in the user's current working directory.`;

export async function suggestCommand(
  query: string,
  session: Session,
  signal: AbortSignal,
): Promise<string> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return theme.warn('usage: /suggest <request>\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SUGGEST_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current working directory: ${session.state.cwd}\nRequest: ${trimmedQuery}`,
    },
  ];

  let suggestion = '';
  const result = await streamChat({
    model: session.state.model,
    messages,
    temperature: 0.1,
    signal,
    onToken: (token) => {
      suggestion += token;
    },
  });

  const command = sanitizeSuggestion(result.content || suggestion);
  return `${theme.brand('Suggested command')}\n  ${theme.hl(command)}\n`;
}

function sanitizeSuggestion(content: string): string {
  const withoutFences = content
    .trim()
    .replace(/^```(?:\w+)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();

  return withoutFences || 'echo "No command suggested"';
}
