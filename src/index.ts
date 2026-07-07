import './util/perf.js';
import { enablePerfTrace, markFirstPrompt } from './util/perf.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runInteractive } from './modes/interactive.js';
import { runAutopilot } from './modes/autopilot.js';
import { runOneShot } from './modes/oneshot.js';
import { runTui } from './modes/tui.js';
import { config, setProvider } from './config.js';
import { DEFAULT_API_PORT, getGlobalAPIServer, stopGlobalAPIServer } from './server/api-server.js';
import { theme } from './ui/theme.js';
import { logger } from './logger.js';
import { hookManager, initializeLifecycleHooks } from './hooks/lifecycle.js';
import { hookCommand } from './hooks/precommit.js';
import { Marketplace } from './plugins/marketplace.js';
import { openBrowser } from './util/browser.js';

function friendlyError(err: any): string {
  const message = String(err?.message || err);
  const status = err?.status ?? err?.response?.status;

  // No token configured at all — catch this before any network error
  if (!config.token && config.provider === 'github') {
    return (
      'Authentication is not configured for provider "github".\n' +
      '  Set GITHUB_TOKEN, GH_TOKEN, set ICOPILOT_TOKEN, or sign in with `gh auth login`.'
    );
  }

  if (/GITHUB_TOKEN|ICOPILOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY/i.test(message)) {
    if (config.provider === 'github') {
      return (
        'Authentication is not configured for provider "github".\n' +
        '  Set GITHUB_TOKEN, GH_TOKEN, set ICOPILOT_TOKEN, or sign in with `gh auth login`.'
      );
    }
    return `Authentication is not configured for provider "${config.provider}".\n  Set the provider-specific API key env var, ICOPILOT_TOKEN, or add \`token\` to ~/.icopilotrc.json.`;
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(message)) {
    if (config.provider === 'ollama') {
      return (
        `Cannot reach ${config.endpoint}.\n` +
        '  Ollama is selected but no local server responded. Start it with `ollama serve` or switch providers with `/provider set github`.'
      );
    }
    return `Cannot reach ${config.endpoint} — check your network, --base-url, or ICOPILOT_ENDPOINT.`;
  }
  if (status === 401 || status === 403) {
    return `Authentication failed for provider "${config.provider}". Check its API key/token.`;
  }
  if (status === 404) {
    return `Model ${config.defaultModel} was not found at ${config.endpoint}. Try --model with a supported provider model.`;
  }
  return `fatal: ${logger.redact(message)}`;
}

export function applyCliOptions(opts: any): { previousCwd?: string } {
  let previousCwd: string | undefined;
  if (opts.perfTrace) enablePerfTrace();
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
  if (opts.local && !opts.provider) setProvider('ollama', { persist: false });
  if (opts.provider) setProvider(opts.provider, { persist: false });
  if (opts.baseUrl) {
    config.endpoint = opts.baseUrl;
    if (!opts.provider && !process.env.ICOPILOT_TOKEN) config.token = undefined;
  }

  if (opts.cwd) {
    try {
      previousCwd = config.cwd;
      process.chdir(opts.cwd);
      config.cwd = process.cwd();
    } catch (e: any) {
      process.stderr.write(theme.err(`cannot chdir: ${e?.message}\n`));
      process.exit(2);
    }
  }
  if (opts.model) config.defaultModel = opts.model;
  return { previousCwd };
}

export async function run(opts: any): Promise<void> {
  const { previousCwd } = applyCliOptions(opts);
  await initializeLifecycleHooks(config.cwd);
  if (previousCwd && previousCwd !== config.cwd) {
    await hookManager.emit('cwdChanged', {
      previousCwd,
      newCwd: config.cwd,
      source: 'cli-option',
    });
  }

  if (opts.autopilot && opts.architect) {
    throw new Error('--architect cannot be combined with --autopilot.');
  }

  if (opts.browser !== undefined) {
    const port = normalizeServePort(opts.browser);
    const server = getGlobalAPIServer();
    const actualPort = await server.start(port);
    const url = `http://127.0.0.1:${actualPort}/`;
    try {
      await openBrowser(url);
      process.stdout.write(theme.ok(`Opened browser UI at ${url}\n`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(theme.warn(`failed to open browser automatically: ${message}\n`));
      process.stdout.write(theme.dim(`Open ${url} manually.\n`));
    }
    const shutdown = async () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      await stopGlobalAPIServer().catch(() => undefined);
      process.exit(0);
    };
    const onSigint = () => {
      void shutdown();
    };
    const onSigterm = () => {
      void shutdown();
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    return;
  }

  if (opts.serve !== undefined) {
    const port = normalizeServePort(opts.serve);
    const server = getGlobalAPIServer();
    const actualPort = await server.start(port);
    const shutdown = async () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      await stopGlobalAPIServer().catch(() => undefined);
      process.exit(0);
    };
    const onSigint = () => {
      void shutdown();
    };
    const onSigterm = () => {
      void shutdown();
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    process.stdout.write(theme.ok(`API server listening on http://127.0.0.1:${actualPort}\n`));
    return;
  }

  if (opts.prompt) {
    markFirstPrompt();
    if (opts.autopilot) {
      await runAutopilot(opts.prompt, { model: opts.model, cwd: config.cwd });
      return;
    }
    await runOneShot(opts.prompt, {
      model: opts.model,
      plan: !!opts.plan,
      turnMode: opts.architect ? 'architect' : opts.reason ? 'reason' : undefined,
    });
    return;
  }
  if (opts.autopilot) {
    throw new Error('--autopilot requires --prompt.');
  }
  markFirstPrompt();
  // Always use the Copilot CLI-style TUI; --tui kept for backwards compatibility.
  await runTui(opts.plan ? 'plan' : 'ask', {
    defaultTurnMode: opts.architect ? 'architect' : opts.reason ? 'reason' : undefined,
  });
}

export function createProgram(): Command {
  const _require = createRequire(import.meta.url);
  // dist/index.js → ../../package.json won't work; resolve from CWD or use __dirname equivalent
  let pkgVersion = '0.0.0';
  try {
    const pkgPath = new URL('../package.json', import.meta.url).pathname;
    pkgVersion = (_require(pkgPath) as { version: string }).version;
  } catch {
    try {
      pkgVersion = (_require('../../package.json') as { version: string }).version;
    } catch {
      /* fallback */
    }
  }
  const invokedAs = path.basename(process.argv[1] ?? 'icopilot').replace(/\.js$/, '');
  const cliName = ['icopilot', 'icli'].includes(invokedAs) ? invokedAs : 'icopilot';
  const program = new Command()
    .name(cliName)
    .description('iCopilot — terminal-native agentic CLI powered by GitHub Models')
    .version(pkgVersion)
    .option('-p, --prompt <text>', 'one-shot mode: run a single prompt and exit')
    .option('-m, --model <name>', 'model id (default: gpt-4o-mini)')
    .option('--local', 'use the default local OpenAI-compatible provider (ollama)')
    .option(
      '--provider <name>',
      'model provider name (github, ollama, vllm, lmstudio, openai, anthropic, or a custom provider)',
    )
    .option('--base-url <url>', 'override the provider base URL for OpenAI-compatible endpoints')
    .option('--plan', 'start in Plan Mode')
    .option('--autopilot', 'run prompt in autopilot mode')
    .option('--architect', 'run in architect mode (planner + coder)')
    .option('--reason', 'stream reasoning, then a polished answer with next steps')
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
    .option('--serve [port]', 'start the HTTP API server')
    .option('--browser [port]', 'start the HTTP API server and open browser UI')
    .option('--perf-trace', 'print cold-start timing to stderr');

  program
    .command('install <plugin>')
    .description('install a marketplace plugin')
    .action(async (plugin: string) => {
      applyCliOptions(program.opts());
      try {
        const installed = await new Marketplace().install(plugin);
        process.stdout.write(
          theme.ok(`✔ installed ${installed.name}`) + ` ${theme.dim(`v${installed.version}`)}\n`,
        );
      } catch (err) {
        process.stderr.write(theme.err(friendlyError(err)) + '\n');
        process.exit(1);
      }
    });

  program
    .command('hook [subcommand] [args...]')
    .description('manage the git pre-commit hook')
    .action(async (subcommand: string | undefined, args: string[] | undefined) => {
      try {
        const result = await hookCommand(
          [subcommand, ...(args ?? [])].filter(
            (value): value is string => typeof value === 'string',
          ),
          config.cwd,
        );
        process.stdout.write(result.output);
        if (result.exitCode !== 0) process.exit(result.exitCode);
      } catch (err) {
        process.stderr.write(theme.err(friendlyError(err)) + '\n');
        process.exit(1);
      }
    });

  program.action(async (opts) => {
    try {
      await run(opts);
    } catch (err) {
      await hookManager.emit('errorOccurred', {
        scope: 'cli',
        message: err instanceof Error ? err.message : String(err),
      });
      process.stderr.write(theme.err(friendlyError(err)) + '\n');
      process.exit(1);
    }
  });

  return program;
}

function normalizeServePort(value: unknown): number {
  if (value === true || value === undefined) return DEFAULT_API_PORT;
  const port = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid --serve port: ${String(value)}`);
  }
  return port;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

if (process.env.ICOPILOT_DISABLE_AUTO_MAIN !== '1') {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const launchedFromBin = entry.endsWith(`${path.sep}bin${path.sep}icopilot.js`);

  if (launchedFromBin || entry) {
    main().catch((err) => {
      hookManager
        .emit('errorOccurred', {
          scope: 'main',
          message: err instanceof Error ? err.message : String(err),
        })
        .finally(() => {
          process.stderr.write(theme.err(friendlyError(err)) + '\n');
          process.exit(1);
        });
    });
  }
}
