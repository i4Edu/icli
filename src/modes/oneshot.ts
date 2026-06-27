import { Session } from '../session/session.js';
import { hookManager } from '../hooks/lifecycle.js';
import { runTurn } from './turn.js';
import { theme } from '../ui/theme.js';

export async function runOneShot(prompt: string, opts: { model?: string; plan?: boolean } = {}) {
  const session = new Session({
    model: opts.model,
    mode: opts.plan ? 'plan' : 'ask',
  });
  await session.initializeGitContext();
  await hookManager.emit('sessionStart', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
  });
  const ac = new AbortController();
  const onSigint = () => {
    ac.abort();
    process.stdout.write(theme.warn('\n⏸  interrupted.\n'));
    process.exit(130);
  };
  process.on('SIGINT', onSigint);
  try {
    await runTurn({ session, userInput: prompt, signal: ac.signal });
  } finally {
    process.off('SIGINT', onSigint);
    await hookManager.emit('sessionEnd', {
      sessionId: session.state.id,
      cwd: session.state.cwd,
      mode: session.state.mode,
      model: session.state.model,
    });
  }
}
