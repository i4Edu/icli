import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statsCommand } from '../../src/commands/stats-cmd.js';

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = path.join(process.cwd(), '.vitest-stats-cmd-tmp', String(process.pid), String(Date.now()));
  file = path.join(tmpDir, 'stats.json');
  process.env.ICOPILOT_STATS_PATH = file;
});

afterEach(() => {
  delete process.env.ICOPILOT_STATS_PATH;
  fs.rmSync(path.join(process.cwd(), '.vitest-stats-cmd-tmp'), { recursive: true, force: true });
});

describe('statsCommand', () => {
  it('show returns a non-empty string', () => {
    expect(statsCommand()).toContain('Usage stats');
    expect(statsCommand('show').length).toBeGreaterThan(0);
  });

  it('reset returns a non-empty string', () => {
    expect(statsCommand('reset').length).toBeGreaterThan(0);
  });

  it('path returns a non-empty string', () => {
    const output = statsCommand('path');
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain(file);
  });
});
