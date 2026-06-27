import { theme } from '../ui/theme.js';

export interface MultiResponse {
  model: string;
  content: string;
  tokens: number;
  durationMs: number;
}

export interface MultiConfig {
  models: string[];
  maxTokens: number;
}

const DEFAULT_MAX_TOKENS = 2048;
const MAX_MODELS = 4;
const MODEL_STYLERS = [theme.brand, theme.user, theme.assistant, theme.hl] as const;

export function buildMultiConfig(args: string[]): MultiConfig | { error: string } {
  const raw = args.join(' ').trim();
  if (!raw) {
    return { error: multiUsage('Provide 1 to 4 comma-separated model names.') };
  }

  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (models.length === 0) {
    return { error: multiUsage('Provide 1 to 4 comma-separated model names.') };
  }

  if (models.length > MAX_MODELS) {
    return { error: multiUsage(`You can compare at most ${MAX_MODELS} models at once.`) };
  }

  return {
    models,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

export function formatMultiResponses(responses: MultiResponse[]): string {
  if (responses.length === 0) {
    return `${theme.warn('No model responses to compare.')}\n`;
  }

  const blocks = responses.map((response, index) => {
    const style = MODEL_STYLERS[index % MODEL_STYLERS.length];
    const header = style(`Model ${index + 1}: ${response.model}`);
    const metrics = theme.dim(
      `tokens: ${response.tokens.toLocaleString()}  •  duration: ${formatDuration(response.durationMs)}`,
    );

    return [header, response.content.trim() || theme.dim('(empty response)'), metrics].join('\n');
  });

  return `${theme.brand('Multi-model comparison')}\n\n${blocks.join(`\n\n${theme.dim('─'.repeat(48))}\n\n`)}\n`;
}

function multiUsage(reason: string): string {
  return `${theme.warn(reason)}\nusage: /multi <model-a,model-b[,model-c,model-d]>\nexample: /multi gpt-4o,gpt-4o-mini\n`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}
