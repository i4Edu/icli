import './util/perf.js';
import { markFirstPrompt } from './util/perf.js';
import { Command } from 'commander';
import { runInteractive } from './modes/interactive.js';
import { runOneShot } from './modes/oneshot.js';
import { runTui } from './modes/tui.js';
import { config } from './config.js';
import { theme } from './ui/theme.js';
import { logger } from './logger.js';

const program = new Command();

function friendlyError(err: any): string {
  const message = String(err?.message || err);
  const status = err?.status ?? err?.response?.status;
  if (/GITHUB_TOKEN|ICOPILOT_TOKEN/i.test(message)) {
    return (
      'GITHUB_TOKEN is not set.\n' +
      '  Run `gh auth status`, then set `$env:GITHUB_TOKEN = gh auth token`, or add `token` to ~/.icopilotrc.json.'
    );
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return `Cannot reach ${config.endpoint} — check your network or ICOPILOT_ENDPOINT.`;
  }
  if (status === 401 || status === 403) {
    return 'Authentication failed. Check GITHUB_TOKEN has models:read scope.';
  }
  if (status === 404) {
    return `Model ${config.defaultModel} not found on GitHub Models endpoint. Try /model gpt-4o-mini.`;
  }
  return `fatal: ${logger.redact(message)}`;
}

async function run(opts: any): Promise<void> {
  if (opts.verbose) {
    config.verbose = true;
    config.logLevel = 'debug';
  }
  if (opts.logLevel) config.logLevel = opts.logLevel;
  if (opts.sandbox) {
    config.sandbox = true;
    process.env.ICOPILOT_SANDBOX = '1';
  }
  if (opts.color === false) config.theme = 'none';
  if (opts.theme) config.theme = opts.theme;
  if (opts.policy) config.policyPath = opts.policy;

  if (opts.cwd) {
    try {
      process.chdir(opts.cwd);
      config.cwd = process.cwd();
    } catch (e: any) {
      process.stderr.write(theme.err(`cannot chdir: ${e?.message}\n`));
      process.exit(2);
    }
  }
  if (opts.model) config.defaultModel = opts.model;

  if (!config.token) {
    throw new Error('GITHUB_TOKEN is not set.');
  }

  if (opts.prompt) {
    markFirstPrompt('startup');
    await runOneShot(opts.prompt, { model: opts.model, plan: !!opts.plan });
    return;
  }
  markFirstPrompt('startup');
  if (opts.tui) {
    try {
      await runTui(opts.plan ? 'plan' : 'ask');
    } catch (err) {
      throw err;
    }
    return;
  }
  await runInteractive(opts.plan ? 'plan' : 'ask');
}

program
  .name('icopilot')
  .description('iCopilot — terminal-native agentic CLI powered by GitHub Models')
  .version('0.1.0')
  .option('-p, --prompt <text>', 'one-shot mode: run a single prompt and exit')
  .option('-m, --model <name>', 'model id (default: gpt-4o-mini)')
  .option('--plan', 'start in Plan Mode')
  .option('--tui', 'start the experimental full-screen TUI')
  .option('--cwd <path>', 'set working directory')
  .option('-v, --verbose', 'enable verbose debug logging')
  .option('--sandbox', 'enable sandbox policy enforcement')
  .option('--log-level <level>', 'debug, info, warn, or error')
  .option('--no-color', 'disable colored output')
  .option('--theme <name>', 'auto, light, dark, or none')
  .option('--policy <file>', 'policy file path')
  .option('--perf-trace', 'print cold-start timing to stderr')
  .action(async (opts) => {
    try {
      await run(opts);
    } catch (err) {
      process.stderr.write(theme.err(friendlyError(err)) + '\n');
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(theme.err(friendlyError(err)) + '\n');
  process.exit(1);
});
