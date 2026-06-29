import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../session/session.js';
import { theme, banner } from '../ui/theme.js';
import { createPrompt, prefix } from '../ui/prompt.js';
import { handleSlash } from '../commands/slash.js';
import { loadAliases, resolveAlias } from '../commands/alias-cmd.js';
import { MetricsCollector } from '../commands/metrics-cmd.js';
import { runAutopilot } from './autopilot.js';
import { handlePostTurnContextBudget } from './auto-compact.js';
import { runTurn } from './turn.js';
import { config } from '../config.js';
import { backgroundTaskManager } from './background.js';
import { hookManager } from '../hooks/lifecycle.js';
import { applyKeybindingConfig, getKeybindingHelp } from '../util/keybindings.js';
import { getCloudRoutineScheduler } from '../cloud/routine-scheduler.js';
import { createCloudRoutineExecutor } from '../cloud/routine-executor.js';

const require = createRequire(import.meta.url);
const VERSION = require('../../package.json').version as string;

export async function runInteractive(
  initialMode: 'ask' | 'plan' = 'ask',
  opts: { defaultTurnMode?: 'ask' | 'code' | 'architect' } = {},
) {
  const session = new Session({ mode: initialMode });
  await session.initializeGitContext();
  await hookManager.emit('sessionStart', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
  });
  const metrics = new MetricsCollector();

  const scheduler = getCloudRoutineScheduler();
  if (config.cloudRoutines?.enabled) {
    const executor = createCloudRoutineExecutor();
    scheduler.setExecutor(executor);
    scheduler.start();
  }

  // Apply keybinding configuration
  const keybindingMode = applyKeybindingConfig();

  if (!config.quiet) {
    const sessionDir = config.sessionDir ?? path.join(os.homedir(), '.icopilot', 'sessions');
    process.stdout.write(banner(VERSION, session.state.model, sessionDir));
    if (keybindingMode !== 'default') {
      process.stdout.write(getKeybindingHelp(keybindingMode));
    }
  }
  const rl = createPrompt(keybindingMode);

  let running = true;
  let processing = false;
  let currentAbort: AbortController | null = null;
  const pendingInputs: Array<{ line: string; scheduled: boolean }> = [];

  // SIGINT: abort streaming, but never exit (unless pressed at idle twice).
  let lastSigintAt = 0;
  const onSigint = () => {
    if (currentAbort && !currentAbort.signal.aborted) {
      currentAbort.abort();
      process.stdout.write(theme.warn('\n⏸  interrupted.\n'));
      return;
    }
    const now = Date.now();
    if (now - lastSigintAt < 1500) {
      process.stdout.write(theme.dim('\nbye.\n'));
      running = false;
      rl.close();
      return;
    }
    lastSigintAt = now;
    process.stdout.write(theme.dim('\n(press Ctrl-C again to exit)\n'));
  };
  process.on('SIGINT', onSigint);

  const enqueueInput = (line: string, scheduled = false) => {
    pendingInputs.push({ line, scheduled });
    void processQueue();
  };

  const processQueue = async () => {
    if (processing) return;
    processing = true;
    try {
      while (running && pendingInputs.length) {
        const next = pendingInputs.shift();
        if (!next) continue;
        const resolvedLine = resolveAlias(next.line, loadAliases()) ?? next.line;
        currentAbort = new AbortController();
        try {
          if (next.scheduled) {
            process.stdout.write(theme.dim(`\n[schedule] ${next.line}\n`));
          }
          const slash = await handleSlash(resolvedLine, {
            session,
            abort: currentAbort,
            metrics,
            schedulePrompt: (prompt) => enqueueInput(prompt, true),
            exit: () => {
              running = false;
            },
          });
          if (slash.consumed) continue;

          const input = slash.forwardInput ?? resolvedLine;
          if (slash.handled && slash.forwardInput !== undefined) {
            process.stdout.write(formatMessagePreview(slash.forwardInput));
          }

          const trimmedInput = input.trim();
          if (trimmedInput.endsWith('&')) {
            const goal = trimmedInput.slice(0, -1).trim();
            if (!goal) {
              process.stdout.write(theme.warn('\nusage: <prompt> &\n'));
              continue;
            }

            const id = backgroundTaskManager.startTask(goal);
            process.stdout.write(
              theme.ok(`\n↳ started background task ${id.slice(0, 8)} for: ${goal}\n`),
            );
            continue;
          }

          const explicitTurnMode = (slash as { turnMode?: 'ask' | 'code' | 'architect' | null })
            .turnMode;
          const effectiveTurnMode = explicitTurnMode ?? opts.defaultTurnMode;

          if (session.state.autopilotEnabled && !effectiveTurnMode) {
            await runAutopilot(input, {
              session,
              signal: currentAbort.signal,
            });
          } else {
            await runTurn({
              session,
              userInput: input,
              metrics,
              signal: currentAbort.signal,
              turnMode: effectiveTurnMode ?? undefined,
            });
            await handlePostTurnContextBudget(session, currentAbort.signal);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || currentAbort.signal.aborted) {
            // already messaged
          } else {
            await hookManager.emit('errorOccurred', {
              scope: 'interactive',
              sessionId: session.state.id,
              message: e?.message || String(e),
            });
            process.stdout.write(theme.err(`\nerror: ${e?.message || e}\n`));
          }
        } finally {
          currentAbort = null;
        }
      }
    } finally {
      processing = false;
    }
  };

  try {
    while (running) {
      let line: string;
      try {
        line = await rl.read(prefix(session.state.mode));
      } catch {
        break;
      }
      if (!line || !line.trim()) continue;
      enqueueInput(line);
    }
  } finally {
    scheduler.stop();
    process.off('SIGINT', onSigint);
    rl.close();
    await hookManager.emit('sessionEnd', {
      sessionId: session.state.id,
      cwd: session.state.cwd,
      mode: session.state.mode,
      model: session.state.model,
    });
  }
}

function formatMessagePreview(message: string): string {
  const lines = message.trim().split(/\r?\n/);
  const preview = lines.slice(0, 8);
  const suffix =
    lines.length > preview.length
      ? `\n${theme.dim(`… ${lines.length - preview.length} more line(s)`)}`
      : '';
  return `\n${theme.brand('Message preview')}\n${preview.join('\n')}${suffix}\n\n`;
}
