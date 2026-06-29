import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { countTokensSync } from '../util/tokens.js';
import { estimateCost, formatUsd, getRate } from '../util/cost.js';

export function costCommand(session: Session): string {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const message of session.state.messages) {
    const text = contentToText((message as { content?: unknown }).content);
    if (!text) continue;

    const count = countTokensSync(text);
    if ((message as { role?: string }).role === 'assistant') {
      outputTokens += count;
    } else {
      inputTokens += count;
    }
  }

  const model = session.state.model;
  const rate = getRate(model);
  const cost = estimateCost(model, inputTokens, outputTokens);

  return (
    [
      theme.brand('Cost estimate'),
      `  model: ${theme.hl(model)}`,
      `  input tokens: ${theme.hl(String(inputTokens))}`,
      `  output tokens: ${theme.hl(String(outputTokens))}`,
      `  estimated USD: ${theme.ok(formatUsd(cost))}`,
      `  rate used: ${formatUsd(rate.input)} / ${formatUsd(rate.output)} per 1K input/output tokens`,
    ].join('\n') + '\n'
  );
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part !== 'object' || part === null) return '';
        if ('text' in part && typeof part.text === 'string') return part.text;
        if ('type' in part && typeof part.type === 'string') return JSON.stringify(part);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}
