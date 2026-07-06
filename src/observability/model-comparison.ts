import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { client } from '../api/github-models.js';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { countTokensSync } from '../util/tokens.js';

export interface ComparisonResult {
  model: string;
  output: string;
  tokens: number;
  durationMs: number;
  score?: number;
}

export interface ComparisonRun {
  prompt: string;
  models: string[];
  results: ComparisonResult[];
}

export interface ComparisonSummary {
  prompt: string;
  winner?: string;
  differences: string[];
  recommendations: string[];
}

export async function runComparison(
  prompt: string,
  models: string[],
  options: { maxTokens?: number } = {},
): Promise<ComparisonRun> {
  const trimmedPrompt = prompt.trim();
  const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  const selectedModels = uniqueModels.length > 0 ? uniqueModels : [config.defaultModel];
  const completionClient = await client();
  const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: trimmedPrompt }];

  const results = await Promise.all(
    selectedModels.map(async (model) => {
      const startedAt = Date.now();
      const response = await completionClient.chat.completions.create({
        model,
        messages,
        max_tokens: options.maxTokens,
      });
      const output = response.choices[0]?.message?.content ?? '';
      const durationMs = Date.now() - startedAt;
      const tokens =
        response.usage?.total_tokens ?? countTokensSync(trimmedPrompt) + countTokensSync(output);
      const score = scoreResult(output, tokens, durationMs);

      return {
        model,
        output,
        tokens,
        durationMs,
        score,
      };
    }),
  );

  return {
    prompt: trimmedPrompt,
    models: selectedModels,
    results,
  };
}

export function summarizeComparison(run: ComparisonRun): ComparisonSummary {
  const ranked = [...run.results].sort(
    (a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY),
  );
  const winner = ranked[0]?.model;
  const differences = buildDifferences(run.results);
  const recommendations: string[] = [];

  if (winner) {
    recommendations.push(`Prefer ${winner} for prompts similar to this one.`);
  }
  if (ranked.some((result) => result.durationMs > 10_000)) {
    recommendations.push('Consider a lower-latency model for interactive use.');
  }
  if (ranked.some((result) => result.tokens > 4_000)) {
    recommendations.push('Cap max tokens to control response size and cost.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Current model set looks balanced for quality, latency, and token usage.');
  }

  return {
    prompt: run.prompt,
    winner,
    differences,
    recommendations,
  };
}

export function formatComparisonResult(run: ComparisonRun, summary: ComparisonSummary): string {
  const lines = [
    theme.brand('Model comparison'),
    `  prompt: ${theme.dim(shorten(run.prompt, 80))}`,
    `  winner: ${summary.winner ? theme.ok(summary.winner) : theme.dim('none')}`,
    '',
    theme.brand('Results'),
  ];

  for (const result of run.results) {
    lines.push(
      `  ${result.model.padEnd(18)} ${theme.hl(String(result.tokens).padStart(6))} tk  ${theme.dim(`${result.durationMs}ms`).padStart(10)}  ${theme.ok((result.score ?? 0).toFixed(2)).padStart(6)}`,
    );
    lines.push(`    ${shorten(result.output, 120)}`);
  }

  lines.push('', theme.brand('Differences'));
  if (summary.differences.length === 0) {
    lines.push(`  ${theme.dim('Outputs are materially similar.')}`);
  } else {
    summary.differences.forEach((difference) => lines.push(`  - ${difference}`));
  }

  lines.push('', theme.brand('Recommendations'));
  summary.recommendations.forEach((recommendation) => lines.push(`  - ${recommendation}`));
  lines.push('');

  return lines.join('\n');
}

function buildDifferences(results: ComparisonResult[]): string[] {
  if (results.length < 2) return [];

  const outputs = results.map((result) => ({
    model: result.model,
    length: result.output.trim().length,
    firstLine: result.output.trim().split(/\r?\n/, 1)[0] ?? '',
  }));
  const differences: string[] = [];
  const lengths = outputs.map((output) => output.length);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);

  if (longest - shortest > 150) {
    const verbose = outputs.find((output) => output.length === longest);
    const concise = outputs.find((output) => output.length === shortest);
    if (verbose && concise) {
      differences.push(`${verbose.model} is much more verbose than ${concise.model}.`);
    }
  }

  const distinctOpeners = new Set(outputs.map((output) => output.firstLine));
  if (distinctOpeners.size > 1) {
    differences.push('Models take noticeably different framing approaches in their opening lines.');
  }

  const tokenSpread = Math.max(...results.map((result) => result.tokens)) - Math.min(...results.map((result) => result.tokens));
  if (tokenSpread > 500) {
    differences.push('Token usage varies significantly across the selected models.');
  }

  return differences;
}

function scoreResult(output: string, tokens: number, durationMs: number): number {
  const usefulText = output.trim().length;
  const richness = Math.min(1, usefulText / 500);
  const efficiency = tokens > 0 ? Math.max(0, 1 - Math.min(1, tokens / 8_000)) : 0;
  const latency = Math.max(0, 1 - Math.min(1, durationMs / 20_000));
  return Number((richness * 0.55 + efficiency * 0.25 + latency * 0.2).toFixed(2));
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
