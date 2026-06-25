import { Session } from '../session/session.js';
import { theme, banner } from '../ui/theme.js';
import { createPrompt, prefix } from '../ui/prompt.js';
import { handleSlash } from '../commands/slash.js';
import { runTurn } from './turn.js';
import { config } from '../config.js';

const VERSION = '0.1.0';

export async function runInteractive(initialMode: 'ask' | 'plan' = 'ask') {
  const session = new Session({ mode: initialMode });
  process.stdout.write(banner(VERSION, session.state.model));
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

    currentAbort = new AbortController();
    try {
      const slash = await handleSlash(line, {
        session,
        abort: currentAbort,
        exit: () => {
          running = false;
        },
      });
      if (slash.consumed) continue;

      await runTurn({
        session,
        userInput: line,
        signal: currentAbort.signal,
      });

      // Soft budget warning
      const used = session.tokenUsage();
      if (used / config.contextWindow > config.contextWarn) {
        process.stdout.write(
          theme.warn(
            `\n⚠  context ${((used / config.contextWindow) * 100).toFixed(0)}% full — run /compact to free space.\n`,
          ),
        );
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
