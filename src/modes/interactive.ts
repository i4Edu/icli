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

const VERSION = '1.3.0';

export async function runInteractive(initialMode: 'ask' | 'plan' = 'ask') {
  const session = new Session({ mode: initialMode });
  await session.initializeGitContext();
  const metrics = new MetricsCollector();
  if (!config.quiet) {
    process.stdout.write(banner(VERSION, session.state.model));
  }
  const rl = createPrompt();

  let running = true;
  let currentAbort: AbortController | null = null;

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
      process.exit(0);
    }
    lastSigintAt = now;
    process.stdout.write(theme.dim('\n(press Ctrl-C again to exit)\n'));
  };
  process.on('SIGINT', onSigint);

  while (running) {
    let line: string;
    try {
      line = await rl.read(prefix(session.state.mode));
    } catch {
      break;
    }
    if (!line || !line.trim()) continue;

    const resolvedLine = resolveAlias(line, loadAliases()) ?? line;
    currentAbort = new AbortController();
    try {
      const slash = await handleSlash(resolvedLine, {
        session,
        abort: currentAbort,
        metrics,
        exit: () => {
          running = false;
        },
      });
      if (slash.consumed) continue;

      const trimmedLine = resolvedLine.trim();
      if (trimmedLine.endsWith('&')) {
        const goal = trimmedLine.slice(0, -1).trim();
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

      const input = slash.forwardInput ?? resolvedLine;
      if (session.state.autopilotEnabled) {
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
        });
        await handlePostTurnContextBudget(session, currentAbort.signal);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || currentAbort.signal.aborted) {
        // already messaged
      } else {
        process.stdout.write(theme.err(`\nerror: ${e?.message || e}\n`));
      }
    } finally {
      currentAbort = null;
    }
  }

  process.off('SIGINT', onSigint);
  rl.close();
}
