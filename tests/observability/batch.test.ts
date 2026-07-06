import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/github-models.js', () => ({
  client: vi.fn(async () => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

import {
  executeBatch,
  exportBatchReport,
  formatBatchReport,
  loadBatchFile,
} from '../../src/observability/batch.js';

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = path.join(process.cwd(), '.vitest-observability-batch');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  createMock.mockReset();
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('loadBatchFile', () => {
  it('loads prompt definitions from json', () => {
    const filePath = path.join(fixtureRoot, 'batch.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        { id: 'one', prompt: 'Hello {{name}}', variables: { name: 'Ada' } },
        { prompt: 'Second prompt' },
      ]),
      'utf8',
    );

    expect(loadBatchFile(filePath)).toEqual([
      { id: 'one', prompt: 'Hello {{name}}', variables: { name: 'Ada' } },
      { id: 'prompt-2', prompt: 'Second prompt', variables: undefined },
    ]);
  });
});

describe('executeBatch', () => {
  it('executes prompts and summarizes the report', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Result one' } }],
        usage: { total_tokens: 21 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Result two' } }],
        usage: { total_tokens: 34 },
      });

    const report = await executeBatch(
      [
        { id: 'one', prompt: 'Hello {{name}}', variables: { name: 'Ada' } },
        { id: 'two', prompt: 'Ship it' },
      ],
      { concurrency: 2, model: 'gpt-test' },
    );

    expect(report.successCount).toBe(2);
    expect(report.errorCount).toBe(0);
    expect(report.totalTokens).toBe(55);
    expect(report.results[0]).toMatchObject({
      id: 'one',
      prompt: 'Hello Ada',
      output: 'Result one',
      status: 'success',
    });
    expect(formatBatchReport(report)).toContain('Batch report');
    expect(formatBatchReport(report)).toContain('Result one');
  });

  it('records errors from failed prompts', async () => {
    createMock.mockRejectedValueOnce(new Error('upstream unavailable'));

    const report = await executeBatch([{ id: 'broken', prompt: 'Fail please' }], {
      model: 'gpt-test',
    });

    expect(report.successCount).toBe(0);
    expect(report.errorCount).toBe(1);
    expect(report.results[0]?.status).toBe('error');
    expect(report.results[0]?.error).toContain('upstream unavailable');
  });
});

describe('exportBatchReport', () => {
  it('exports markdown and csv reports', () => {
    const report = {
      results: [
        {
          id: 'one',
          prompt: 'Hello Ada',
          output: 'Result one',
          tokens: 21,
          durationMs: 50,
          status: 'success' as const,
        },
      ],
      totalTokens: 21,
      totalDuration: 50,
      successCount: 1,
      errorCount: 0,
    };

    const markdownPath = path.join(fixtureRoot, 'report.md');
    const csvPath = path.join(fixtureRoot, 'report.csv');
    exportBatchReport(report, markdownPath, 'md');
    exportBatchReport(report, csvPath, 'csv');

    expect(fs.readFileSync(markdownPath, 'utf8')).toContain('# Batch report');
    expect(fs.readFileSync(csvPath, 'utf8')).toContain('"id","status","tokens"');
  });
});
