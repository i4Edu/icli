import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.vitest-ci-flags-'));
  process.env = {
    ...originalEnv,
    GITHUB_TOKEN: 'test-token',
    ICOPILOT_DISABLE_AUTO_MAIN: '1',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('CI scripting flags', () => {
  it('sets config from --json, --quiet, and --yes flags', async () => {
    const { applyCliOptions } = await import('../../src/index.js');
    const { config } = await import('../../src/config.js');

    applyCliOptions({ json: true, quiet: true, yes: true });

    expect(config.jsonOutput).toBe(true);
    expect(config.quiet).toBe(true);
    expect(config.autoApprove).toBe(true);
  }, 60_000);

  it('switches to the default local provider when --local is used', async () => {
    const { applyCliOptions } = await import('../../src/index.js');
    const { config } = await import('../../src/config.js');

    applyCliOptions({ local: true });

    expect(config.provider).toBe('ollama');
    expect(config.endpoint).toBe('http://127.0.0.1:11434/v1');
    expect(config.defaultModel).toBe('llama3.2');
  }, 20_000);

  it('routes --architect one-shot prompts through architect turn mode', async () => {
    const runOneShotMock = vi.fn();
    vi.doMock('../../src/modes/oneshot.js', () => ({
      runOneShot: runOneShotMock,
    }));

    const { run } = await import('../../src/index.js');
    await run({
      prompt: 'design and implement caching',
      architect: true,
    });

    expect(runOneShotMock).toHaveBeenCalledWith('design and implement caching', {
      model: undefined,
      plan: false,
      turnMode: 'architect',
    });
  }, 20_000);

  it('suppresses the interactive banner when quiet mode is enabled', async () => {
    const read = vi.fn().mockRejectedValue(new Error('stop'));
    const close = vi.fn();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    vi.doMock('../../src/ui/prompt.js', () => ({
      createPrompt: () => ({ read, close }),
      prefix: () => '> ',
    }));

    const { config } = await import('../../src/config.js');
    config.quiet = true;
    config.sessionDir = tempRoot;

    const { runInteractive } = await import('../../src/modes/interactive.js');

    await runInteractive('ask');

    expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('iCopilot');
  }, 20_000);

  it('skips write confirmation when autoApprove is enabled', async () => {
    const confirm = vi.fn();

    vi.doMock('@inquirer/prompts', () => ({ confirm }));

    const { config } = await import('../../src/config.js');
    config.autoApprove = true;
    config.cwd = tempRoot;
    config.quiet = true;

    const { proposeWrite } = await import('../../src/tools/file-ops.js');

    const writeResult = await proposeWrite('nested\\auto.txt', 'hello\n');

    expect(writeResult.wrote).toBe(true);
    expect(fs.readFileSync(path.join(tempRoot, 'nested', 'auto.txt'), 'utf8')).toBe('hello\n');
    expect(confirm).not.toHaveBeenCalled();
  }, 20_000);
});
