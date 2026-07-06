import path from 'node:path';
import { config } from '../config.js';
import {
  executeBatch,
  exportBatchReport,
  formatBatchReport,
  loadBatchFile,
} from '../observability/batch.js';
import { theme } from '../ui/theme.js';

export async function batchCommand(args: string[]): Promise<string> {
  if (args.length === 0) {
    return `${theme.warn('usage: /batch <file> [--model <name>] [--concurrency <n>] [--out <path>] [--format json|csv|md]')}\n`;
  }

  const filePath = args[0];
  const options = parseBatchArgs(args.slice(1));
  const prompts = loadBatchFile(path.resolve(config.cwd, filePath));
  const report = await executeBatch(prompts, {
    concurrency: options.concurrency,
    model: options.model,
  });

  if (options.outPath) {
    exportBatchReport(report, path.resolve(config.cwd, options.outPath), options.format);
  }

  const suffix = options.outPath
    ? `\n${theme.ok(`✔ exported report to ${path.resolve(config.cwd, options.outPath)}`)}`
    : '';
  return `${formatBatchReport(report).trimEnd()}${suffix}\n`;
}

function parseBatchArgs(args: string[]): {
  model?: string;
  concurrency?: number;
  outPath?: string;
  format: 'json' | 'csv' | 'md';
} {
  let model: string | undefined;
  let concurrency: number | undefined;
  let outPath: string | undefined;
  let format: 'json' | 'csv' | 'md' = 'json';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model') {
      model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--concurrency') {
      const parsed = Number(args[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        concurrency = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (arg === '--out') {
      outPath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--format') {
      const next = args[index + 1];
      if (next === 'json' || next === 'csv' || next === 'md') {
        format = next;
      }
      index += 1;
    }
  }

  return { model, concurrency, outPath, format };
}
