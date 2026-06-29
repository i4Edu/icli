import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadAliases, resolveAlias } from '../commands/alias-cmd.js';
import { MetricsCollector } from '../commands/metrics-cmd.js';
import { handleSlash } from '../commands/slash.js';
import { Session } from '../session/session.js';
import {
  altScreenEnter,
  altScreenExit,
  clear,
  hideCursor,
  showCursor,
  size,
} from '../ui/screen.js';
import { handlePostTurnContextBudget } from './auto-compact.js';
import { backgroundTaskManager } from './background.js';
import { runAutopilot } from './autopilot.js';
import { runTurn } from './turn.js';
import { hookManager } from '../hooks/lifecycle.js';

const VERSION = '1.3.0';
const FRAME_MS = 33;

type StdoutWrite = typeof process.stdout.write;

export async function runTui(
  initialMode: 'ask' | 'plan' = 'ask',
  opts: { defaultTurnMode?: 'ask' | 'code' | 'architect' } = {},
): Promise<void> {
  const session = new Session({ mode: initialMode });
  await session.initializeGitContext();
  await hookManager.emit('sessionStart', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
  });
  const metrics = new MetricsCollector();
  const originalWrite = process.stdout.write.bind(process.stdout) as StdoutWrite;
  const writeRaw = (text: string) => {
    originalWrite(text);
  };

  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as Writable & { columns?: number };
  silentOutput.columns = size().cols;

  let chat = '';
  let running = true;
  let busy = false;
  let dirty = true;
  let cleaned = false;
  let frame: NodeJS.Timeout | undefined;
  let currentAbort: AbortController | null = null;
  const pendingInputs: Array<{ line: string; scheduled: boolean }> = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: true,
  });

  const markDirty = () => {
    dirty = true;
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    running = false;
    if (currentAbort && !currentAbort.signal.aborted) currentAbort.abort();
    process.stdout.write = originalWrite;
    process.stdout.off('resize', onResize);
    process.off('SIGINT', onSigint);
    process.stdin.off('keypress', markDirty);
    if (frame) clearInterval(frame);
    rl.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    showCursor();
    clear();
    altScreenExit();
  };

  const onSigint = () => {
    cleanup();
    process.exit(0);
  };

  const onResize = () => {
    silentOutput.columns = size().cols;
    markDirty();
  };

  const render = () => {
    if (!dirty) return;
    dirty = false;
    const { rows, cols } = size();
    const chatTop = 2;
    const chatBottom = Math.max(chatTop, rows - 3);
    const chatHeight = Math.max(1, chatBottom - chatTop + 1);

    writeRaw('\x1b[2J\x1b[H');
    writeRaw(statusLine(session, cols, busy));

    const lines = wrapLines(chat.trimEnd(), Math.max(1, cols));
    const visible = lines.slice(-chatHeight);
    for (let i = 0; i < chatHeight; i++) {
      writeRaw(`\x1b[${chatTop + i};1H`);
      writeRaw(pad(visible[i] || '', cols));
    }

    // separator with thinking indicator
    writeRaw(`\x1b[${Math.max(1, rows - 2)};1H`);
    if (busy) {
      const thinkLabel = ' ◆ Copilot is thinking… ';
      const sideLen = Math.max(0, Math.floor((cols - thinkLabel.length) / 2));
      writeRaw('─'.repeat(sideLen) + thinkLabel + '─'.repeat(Math.max(0, cols - sideLen - thinkLabel.length)));
    } else {
      writeRaw('─'.repeat(cols));
    }

    writeRaw(`\x1b[${Math.max(1, rows - 1)};1H`);
    const promptIcon = busy ? '\x1b[33m◆\x1b[0m' : '\x1b[32m❯\x1b[0m';
    const prompt = `${promptIcon} ${rl.line || ''}`;
    writeRaw(pad(prompt, cols));
    writeRaw(`\x1b[${rows};1H`);
    const hint = busy
      ? '\x1b[2m Ctrl+C to cancel  \x1b[0m'
      : '\x1b[2m Enter to send  •  /help for commands  •  /suggest for shell commands \x1b[0m';
    writeRaw(pad(hint, cols));
  };

  const appendCaptured = (chunk: unknown) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    chat += stripAnsi(text);
    markDirty();
  };

  const captureStdout = () => {
    process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
      appendCaptured(chunk);
      if (typeof encoding === 'function') encoding();
      if (typeof cb === 'function') cb();
      return true;
    }) as StdoutWrite;
  };

  const releaseStdout = () => {
    process.stdout.write = originalWrite;
  };

  const handleLine = async (line: string, scheduled = false) => {
    if (busy) {
      pendingInputs.push({ line, scheduled });
      chat += scheduled
        ? `\n(system) queued scheduled prompt: ${line}\n`
        : '\n(system) still working; prompt queued.\n';
      markDirty();
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) return;

    busy = true;
    currentAbort = new AbortController();
    const resolvedLine = resolveAlias(line, loadAliases()) ?? line;
    chat += `\n${scheduled ? '⏱' : '❯'} ${line}\n`;
    markDirty();

    try {
      captureStdout();
      const slash = await handleSlash(resolvedLine, {
        session,
        abort: currentAbort,
        metrics,
        schedulePrompt: (prompt) => void handleLine(prompt, true),
        exit: () => {
          running = false;
        },
      });
      if (!slash.consumed) {
        const forwardInput = slash.forwardInput ?? resolvedLine;
        const trimmedForwardInput = forwardInput.trim();
        if (trimmedForwardInput.endsWith('&')) {
          const goal = trimmedForwardInput.slice(0, -1).trim();
          if (!goal) {
            process.stdout.write('\nusage: <prompt> &\n');
          } else {
            const id = backgroundTaskManager.startTask(goal);
            process.stdout.write(`\n↳ started background task ${id.slice(0, 8)} for: ${goal}\n`);
          }
          return;
        }

        const explicitTurnMode = (slash as { turnMode?: 'ask' | 'code' | 'architect' | null })
          .turnMode;
        const effectiveTurnMode = explicitTurnMode ?? opts.defaultTurnMode;

        if (session.state.autopilotEnabled && !effectiveTurnMode) {
          await runAutopilot(forwardInput, {
            session,
            signal: currentAbort.signal,
          });
        } else {
          await runTurn({
            session,
            userInput: forwardInput,
            metrics,
            signal: currentAbort.signal,
            turnMode: effectiveTurnMode ?? undefined,
          });
        }
        await handlePostTurnContextBudget(session, currentAbort.signal);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !currentAbort.signal.aborted) {
        await hookManager.emit('errorOccurred', {
          scope: 'tui',
          sessionId: session.state.id,
          message: err?.message || String(err),
        });
        chat += `\nerror: ${err?.message || err}\n`;
      }
    } finally {
      releaseStdout();
      currentAbort = null;
      busy = false;
      markDirty();
      const next = pendingInputs.shift();
      if (next) void handleLine(next.line, next.scheduled);
      if (!running) cleanup();
    }
  };

  readline.emitKeypressEvents(process.stdin, rl);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.on('resize', onResize);
  process.on('SIGINT', onSigint);
  rl.on('line', (line) => void handleLine(line));
  rl.on('close', () => {
    if (running) cleanup();
  });
  process.stdin.on('keypress', markDirty);

  altScreenEnter();
  hideCursor();
  clear();
  chat = 'Welcome to iCopilot TUI prototype. Type /help for commands.\n';

  frame = setInterval(render, FRAME_MS);
  try {
    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (!running) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
    });
  } finally {
    if (running) cleanup();
    await hookManager.emit('sessionEnd', {
      sessionId: session.state.id,
      cwd: session.state.cwd,
      mode: session.state.mode,
      model: session.state.model,
    });
  }
}

function statusLine(session: Session, cols: number, busy: boolean): string {
  const mode = session.state.mode.toUpperCase();
  const modelShort = session.state.model.replace('openai/', '').replace('github/', '');
  const busyBadge = busy ? ' \x1b[33m◆ WORKING\x1b[0;7m' : '';
  const text = ` \x1b[1miCopilot\x1b[0;7m v${VERSION}${busyBadge}  │  model: ${modelShort}  │  mode: ${mode}  │  Ctrl+C to exit `;
  return `\x1b[7m${pad(text, cols)}\x1b[0m`;
}

function wrapLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine || ' ';
    for (let i = 0; i < line.length; i += width) {
      out.push(line.slice(i, i + width));
    }
  }
  return out.length ? out : [''];
}

function pad(text: string, cols: number): string {
  const clipped = text.length > cols ? text.slice(0, cols) : text;
  return clipped + ' '.repeat(Math.max(0, cols - clipped.length));
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
