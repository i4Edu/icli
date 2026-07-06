import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { parse as parseYaml } from 'yaml';
import { client } from '../api/github-models.js';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { countTokensSync } from '../util/tokens.js';

export interface BatchPrompt {
  id: string;
  prompt: string;
  variables?: Record<string, string>;
}

export interface BatchResult {
  id: string;
  prompt: string;
  output: string;
  tokens: number;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

export interface BatchReport {
  results: BatchResult[];
  totalTokens: number;
  totalDuration: number;
  successCount: number;
  errorCount: number;
}

export function loadBatchFile(filePath: string): BatchPrompt[] {
  const resolvedPath = path.resolve(filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const ext = path.extname(resolvedPath).toLowerCase();
  const parsed = parseBatchPayload(raw, ext);

  if (!Array.isArray(parsed)) {
    throw new Error('batch file must contain an array of prompts');
  }

  return parsed.map((entry, index) => normalizeBatchPrompt(entry, index));
}

export async function executeBatch(
  prompts: BatchPrompt[],
  options: { concurrency?: number; model?: string } = {},
): Promise<BatchReport> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  const model = options.model?.trim() || config.defaultModel;
  const completionClient = await client();
  const results: BatchResult[] = new Array(prompts.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= prompts.length) return;
      const prompt = prompts[currentIndex];
      const renderedPrompt = renderPrompt(prompt);
      const startedAt = Date.now();

      try {
        const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: renderedPrompt }];
        const response = await completionClient.chat.completions.create({
          model,
          messages,
        });
        const output = response.choices[0]?.message?.content ?? '';
        results[currentIndex] = {
          id: prompt.id,
          prompt: renderedPrompt,
          output,
          tokens:
            response.usage?.total_tokens ?? countTokensSync(renderedPrompt) + countTokensSync(output),
          durationMs: Date.now() - startedAt,
          status: 'success',
        };
      } catch (error: unknown) {
        results[currentIndex] = {
          id: prompt.id,
          prompt: renderedPrompt,
          output: '',
          tokens: 0,
          durationMs: Date.now() - startedAt,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length || 1) }, () => worker()));

  const totalTokens = results.reduce((sum, result) => sum + result.tokens, 0);
  const totalDuration = results.reduce((sum, result) => sum + result.durationMs, 0);
  const successCount = results.filter((result) => result.status === 'success').length;
  const errorCount = results.length - successCount;

  return {
    results,
    totalTokens,
    totalDuration,
    successCount,
    errorCount,
  };
}

export function formatBatchReport(report: BatchReport): string {
  const lines = [
    theme.brand('Batch report'),
    `  prompts:   ${theme.hl(String(report.results.length))}`,
    `  success:   ${theme.ok(String(report.successCount))}`,
    `  errors:    ${report.errorCount > 0 ? theme.err(String(report.errorCount)) : theme.dim('0')}`,
    `  tokens:    ${theme.hl(String(report.totalTokens))}`,
    `  duration:  ${theme.dim(formatDuration(report.totalDuration))}`,
    '',
  ];

  if (report.results.length === 0) {
    lines.push(`  ${theme.dim('No prompts executed.')}`, '');
    return lines.join('\n');
  }

  lines.push(theme.brand('Results'));
  for (const result of report.results) {
    const status = result.status === 'success' ? theme.ok('ok') : theme.err('error');
    lines.push(
      `  ${result.id.padEnd(12)} ${status.padEnd(5)} ${theme.hl(String(result.tokens).padStart(6))} tk  ${theme.dim(formatDuration(result.durationMs)).padStart(8)}`,
    );
    lines.push(`    ${result.status === 'success' ? shorten(result.output, 120) : theme.err(result.error || 'unknown error')}`);
  }
  lines.push('');

  return lines.join('\n');
}

export function exportBatchReport(
  report: BatchReport,
  outputPath: string,
  format: 'json' | 'csv' | 'md' = 'json',
): void {
  const resolvedPath = path.resolve(outputPath);
  const payload =
    format === 'json' ? JSON.stringify(report, null, 2) : format === 'csv' ? toCsv(report) : toMarkdown(report);
  fs.writeFileSync(resolvedPath, payload, 'utf8');
}

function parseBatchPayload(raw: string, ext: string): unknown {
  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(raw);
  }
  return JSON.parse(raw);
}

function normalizeBatchPrompt(entry: unknown, index: number): BatchPrompt {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`invalid batch prompt at index ${index}`);
  }

  const record = entry as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt : '';
  if (!prompt.trim()) {
    throw new Error(`missing prompt for batch entry ${index}`);
  }

  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id : `prompt-${index + 1}`,
    prompt,
    variables: normalizeVariables(record.variables),
  };
}

function normalizeVariables(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'string' ? [[key, item] as const] : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function renderPrompt(prompt: BatchPrompt): string {
  let rendered = prompt.prompt;
  for (const [key, value] of Object.entries(prompt.variables ?? {})) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function toCsv(report: BatchReport): string {
  const rows = [
    ['id', 'status', 'tokens', 'durationMs', 'prompt', 'output', 'error'],
    ...report.results.map((result) => [
      result.id,
      result.status,
      String(result.tokens),
      String(result.durationMs),
      result.prompt,
      result.output,
      result.error ?? '',
    ]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function toMarkdown(report: BatchReport): string {
  const header = ['# Batch report', '', formatBatchReport(report)];
  const details = report.results.map((result) => [
    `## ${result.id}`,
    '',
    `- Status: ${result.status}`,
    `- Tokens: ${result.tokens}`,
    `- Duration: ${result.durationMs}ms`,
    `- Prompt: ${result.prompt}`,
    result.status === 'success' ? `- Output: ${result.output}` : `- Error: ${result.error ?? 'unknown error'}`,
    '',
  ].join('\n'));
  return [...header, ...details].join('\n');
}

function escapeCsv(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return `"${escaped}"`;
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return theme.dim('no output');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}
