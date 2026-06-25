import readline from 'node:readline';
import { Writable } from 'node:stream';
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
import { runTurn } from './turn.js';

const VERSION = '0.1.0';
const FRAME_MS = 33;

type StdoutWrite = typeof process.stdout.write;

export async function runTui(initialMode: 'ask' | 'plan' = 'ask'): Promise<void> {
  const session = new Session({ mode: initialMode });
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
    writeRaw(statusLine(session, cols));

    const lines = wrapLines(chat.trimEnd(), Math.max(1, cols));
    const visible = lines.slice(-chatHeight);
    for (let i = 0; i < chatHeight; i++) {
      writeRaw(`\x1b[${chatTop + i};1H`);
      writeRaw(pad(visible[i] || '', cols));
    }

    writeRaw(`\x1b[${Math.max(1, rows - 2)};1H`);
    writeRaw('─'.repeat(cols));
    writeRaw(`\x1b[${Math.max(1, rows - 1)};1H`);
    const prompt = `${busy ? '…' : '❯'} ${rl.line || ''}`;
    writeRaw(pad(prompt, cols));
    writeRaw(`\x1b[${rows};1H`);
    writeRaw(pad(busy ? 'Working…' : 'Enter to send • /help for commands', cols));
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

  const handleLine = async (line: string) => {
    if (busy) {
      chat += '\n(system) still working; wait for the current turn to finish.\n';
      markDirty();
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) return;

    busy = true;
    currentAbort = new AbortController();
    chat += `\n❯ ${line}\n`;
    markDirty();

    try {
      captureStdout();
      const slash = await handleSlash(line, {
        session,
        abort: currentAbort,
        exit: () => {
          running = false;
        },
      });
      if (!slash.consumed) {
        await runTurn({ session, userInput: line, signal: currentAbort.signal });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !currentAbort.signal.aborted) {
        chat += `\nerror: ${err?.message || err}\n`;
      }
    } finally {
      releaseStdout();
      currentAbort = null;
      busy = false;
      markDirty();
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
  }
}

function statusLine(session: Session, cols: number): string {
  const mode = session.state.mode.toUpperCase();
  const text = ` iCopilot v${VERSION} • model: ${session.state.model} • mode: ${mode}  Ctrl+C to exit`;
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
