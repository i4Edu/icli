import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadStats,
  recordCommand,
  recordSession,
  recordTokens,
  recordToolCall,
  resetStats,
} from '../../src/stats/store.js';

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = path.join(process.cwd(), '.vitest-stats-tmp', String(process.pid), String(Date.now()));
  file = path.join(tmpDir, 'stats.json');
  process.env.ICOPILOT_STATS_PATH = file;
});

afterEach(() => {
  delete process.env.ICOPILOT_STATS_PATH;
  fs.rmSync(path.join(process.cwd(), '.vitest-stats-tmp'), { recursive: true, force: true });
});

describe('stats store', () => {
  it('record functions accumulate correctly', () => {
    recordTokens(10, 20);
    recordTokens(3, 4);
    recordToolCall('shell');
    recordToolCall('shell');
    recordToolCall('grep');
    recordCommand('stats');
    recordCommand('stats');
    recordSession();
    recordSession();

    const s = loadStats();
    expect(s.tokensIn).toBe(13);
    expect(s.tokensOut).toBe(24);
    expect(s.toolCalls).toEqual({ shell: 2, grep: 1 });
    expect(s.commands).toEqual({ stats: 2 });
    expect(s.sessions).toBe(2);
  });

  it('reset clears counters', () => {
    recordTokens(10, 20);
    recordToolCall('shell');
    recordCommand('stats');
    recordSession();

    resetStats();

    const s = loadStats();
    expect(s.tokensIn).toBe(0);
    expect(s.tokensOut).toBe(0);
    expect(s.toolCalls).toEqual({});
    expect(s.commands).toEqual({});
    expect(s.sessions).toBe(0);
  });

  it('load is idempotent', () => {
    const first = loadStats();
    const second = loadStats();

    expect(second).toEqual(first);
    expect(fs.existsSync(file)).toBe(false);
  });
});
