import './util/perf.js';
import { markFirstPrompt } from './util/perf.js';
import path from 'node:path';
import { Command } from 'commander';
import { runInteractive } from './modes/interactive.js';
import { runAutopilot } from './modes/autopilot.js';
import { runOneShot } from './modes/oneshot.js';
import { runTui } from './modes/tui.js';
import { config } from './config.js';
import { theme } from './ui/theme.js';
import { logger } from './logger.js';

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

export function applyCliOptions(opts: any): void {
  if (opts.verbose) {
    config.verbose = true;
    config.logLevel = 'debug';
  }
  if (opts.logLevel) config.logLevel = opts.logLevel;
  if (opts.sandbox) {
    config.sandbox = true;
    process.env.ICOPILOT_SANDBOX = '1';
  }
  if (opts.autoCompact === false) config.autoCompact = false;
  if (opts.color === false) config.theme = 'none';
  if (opts.theme) config.theme = opts.theme;
  if (opts.policy) config.policyPath = opts.policy;
  if (opts.json) config.jsonOutput = true;
  if (opts.quiet) config.quiet = true;
  if (opts.yes || opts.noConfirm) config.autoApprove = true;

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
}

export async function run(opts: any): Promise<void> {
  applyCliOptions(opts);

  if (!config.token) {
    throw new Error('GITHUB_TOKEN is not set.');
  }

  if (opts.prompt) {
    markFirstPrompt('startup');
    if (opts.autopilot) {
      await runAutopilot(opts.prompt, { model: opts.model, cwd: config.cwd });
      return;
    }
    await runOneShot(opts.prompt, { model: opts.model, plan: !!opts.plan });
    return;
  }
  if (opts.autopilot) {
    throw new Error('--autopilot requires --prompt.');
  }
  markFirstPrompt('startup');
  if (opts.tui) {
    await runTui(opts.plan ? 'plan' : 'ask');
    return;
  }
  await runInteractive(opts.plan ? 'plan' : 'ask');
}

export function createProgram(): Command {
  return new Command()
    .name('icopilot')
    .description('iCopilot — terminal-native agentic CLI powered by GitHub Models')
    .version('1.3.0')
    .option('-p, --prompt <text>', 'one-shot mode: run a single prompt and exit')
    .option('-m, --model <name>', 'model id (default: gpt-4o-mini)')
    .option('--plan', 'start in Plan Mode')
    .option('--autopilot', 'run prompt in autopilot mode')
    .option('--tui', 'start the experimental full-screen TUI')
    .option('--cwd <path>', 'set working directory')
    .option('-v, --verbose', 'enable verbose debug logging')
    .option('--sandbox', 'enable sandbox policy enforcement')
    .option('--log-level <level>', 'debug, info, warn, or error')
    .option('--no-color', 'disable colored output')
    .option('--no-auto-compact', 'disable automatic context compaction')
    .option('--theme <name>', 'auto, light, dark, or none')
    .option('--policy <file>', 'policy file path')
    .option('--json', 'output assistant responses as JSON')
    .option('-q, --quiet', 'suppress banners and decorative terminal output')
    .option('-y, --yes', 'auto-approve non-critical tool confirmations')
    .option('--no-confirm', 'alias for --yes')
    .option('--perf-trace', 'print cold-start timing to stderr')
    .action(async (opts) => {
      try {
        await run(opts);
      } catch (err) {
        process.stderr.write(theme.err(friendlyError(err)) + '\n');
        process.exit(1);
      }
    });
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

if (process.env.ICOPILOT_DISABLE_AUTO_MAIN !== '1') {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const launchedFromBin = entry.endsWith(`${path.sep}bin${path.sep}icopilot.js`);

  if (launchedFromBin || entry) {
    main().catch((err) => {
      process.stderr.write(theme.err(friendlyError(err)) + '\n');
      process.exit(1);
    });
  }
}
