import readline from 'node:readline';
import { Writable } from 'node:stream';
import simpleGit from 'simple-git';
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
import {
  WORKSPACE_TABS,
  renderTabBar,
  renderHero,
  renderStatusDock,
  magentaSeparator,
  renderFooter,
} from '../ui/tui-layout.js';
import { safeUnicode } from '../ui/theme.js';
import { handlePostTurnContextBudget } from './auto-compact.js';
import { backgroundTaskManager } from './background.js';
import { runAutopilot } from './autopilot.js';
import { runTurn } from './turn.js';
import { hookManager } from '../hooks/lifecycle.js';

const VERSION = '1.3.0';
const FRAME_MS = 33;
const CREDIT_BUDGET = 1000;

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
  let activeTab = 0;
  let gitBranch = '';
  let branchInFlight = false;
  let lastCwd = session.state.cwd;
  const pendingInputs: Array<{ line: string; scheduled: boolean }> = [];

  // Resolve the current git branch once (and on cwd change) for the status dock.
  // A simple in-flight guard avoids overlapping lookups racing to set gitBranch.
  const refreshBranch = () => {
    if (branchInFlight) return;
    branchInFlight = true;
    void (async () => {
      try {
        const git = simpleGit(session.state.cwd);
        if (await git.checkIsRepo()) {
          gitBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
          markDirty();
        }
      } catch {
        /* not a git repo — leave the branch blank */
      } finally {
        branchInFlight = false;
      }
    })();
  };

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
    process.stdin.off('keypress', onKeypress);
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

    // Refresh branch if cwd changed since the last render.
    if (session.state.cwd !== lastCwd) {
      lastCwd = session.state.cwd;
      refreshBranch();
    }

    // Absolute row anchors (1-indexed for ANSI cursor positioning):
    //   row 1            → tabbed navigation header
    //   rows 2..dockRow-1 → hero canvas + conversation timeline
    //   dockRow           → status dock (locked 3 rows above the bottom)
    //   dockRow + 1       → magenta boundary line
    //   dockRow + 2       → input dock
    //   rows (bottom)     → persistent footer
    const tabRow = 1;
    const chatTop = 2;
    // The status dock is locked exactly 3 rows above the absolute bottom, so the
    // four bottom rows are: dock, magenta separator, input dock, footer.
    const dockRow = Math.max(chatTop, rows - 3);
    const separatorRow = Math.min(dockRow + 1, rows);
    const inputRow = Math.min(dockRow + 2, rows);
    const footerRow = Math.min(dockRow + 3, rows);
    const chatBottom = dockRow - 1;
    const chatHeight = Math.max(1, chatBottom - chatTop + 1);

    writeRaw('\x1b[2J\x1b[H');

    // Row 0 — tabbed navigation header.
    writeRaw(`\x1b[${tabRow};1H`);
    writeRaw(renderTabBar(activeTab, cols));

    // Conversation timeline (hero canvas shown only while it is empty).
    const showHero = !chat.trim();
    const heroLines = showHero ? heroCanvas(session, cols) : [];
    const lines = showHero ? heroLines : wrapLines(chat.trimEnd(), Math.max(1, cols));
    const visible = lines.slice(-chatHeight);
    for (let i = 0; i < chatHeight; i++) {
      writeRaw(`\x1b[${chatTop + i};1H`);
      // Hero lines are already padded to the full width (and carry ANSI), so
      // they are written verbatim; plain chat lines are padded here.
      writeRaw(showHero ? visible[i] || '' : padToCols(visible[i] || '', cols));
    }

    // Status dock — left: cwd + branch, right: live consumption metrics.
    writeRaw(`\x1b[${dockRow};1H`);
    writeRaw(statusDock(session, gitBranch, cols, busy));

    // Magenta boundary line.
    writeRaw(`\x1b[${separatorRow};1H`);
    if (busy) {
      const thinkLabel = ' ◆ Copilot is thinking… ';
      const sideLen = Math.max(0, Math.floor((cols - thinkLabel.length) / 2));
      writeRaw(
        '\x1b[35m' +
          '─'.repeat(sideLen) +
          thinkLabel +
          '─'.repeat(Math.max(0, cols - sideLen - thinkLabel.length)) +
          '\x1b[0m',
      );
    } else {
      writeRaw(magentaSeparator(cols));
    }

    // Input dock — a single dedicated line bracket below the separator.
    writeRaw(`\x1b[${inputRow};1H`);
    const promptIcon = busy ? '\x1b[33m◆\x1b[0m' : '\x1b[32m❯\x1b[0m';
    const buffer = (rl.line || '').replace(/\t/g, '');
    writeRaw('\x1b[2K');
    writeRaw(padToCols(`${promptIcon} ${buffer}`, cols));

    // Absolute bottom row — persistent footer legend.
    writeRaw(`\x1b[${footerRow};1H`);
    writeRaw(renderFooter(cols));
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
  const onKeypress = (_ch: unknown, key: readline.Key | undefined) => {
    // Tab / Shift+Tab cycles the workspace navigation tabs.
    if (key?.name === 'tab') {
      const delta = key.shift ? -1 : 1;
      activeTab = (activeTab + delta + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    }
    markDirty();
  };
  process.stdin.on('keypress', onKeypress);

  altScreenEnter();
  hideCursor();
  clear();
  // An empty timeline makes the renderer show the hero/branding canvas (with its
  // tip bulletins) until the first turn produces conversation output.
  chat = '';
  refreshBranch();

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

function heroCanvas(session: Session, cols: number): string[] {
  const modelShort = session.state.model.replace('openai/', '').replace('github/', '');
  return renderHero(
    {
      version: VERSION,
      provider: 'GitHub Models',
      experimental: '/experimental [Active]',
      tips: [
        'Tip: Run /doctor to diagnose your environment configuration and tool availability.',
        'Tool access is determined by your configured role and policy settings.',
        `Active model: ${modelShort}. Type /help for commands or @ to target files.`,
      ],
    },
    cols,
  );
}

function statusDock(session: Session, branch: string, cols: number, busy: boolean): string {
  const modelShort = session.state.model.replace('openai/', '').replace('github/', '');
  // Nerd-font git branch glyph (U+F02A2) when supported, plain label otherwise.
  const branchIcon = safeUnicode ? '\u{F02A2} ' : 'git:';
  const branchLabel = branch ? ` [${branchIcon}${branch}]` : '';
  const left = `${session.state.cwd}${branchLabel}`;
  const used = Math.min(CREDIT_BUDGET, Math.ceil(session.tokenUsage() / 1000));
  const working = busy ? ' \x1b[33m◆ WORKING\x1b[0m  │ ' : '';
  const right = `${working}Usage: ${used}/${CREDIT_BUDGET} credits  │  ${modelShort}`;
  return renderStatusDock(left, right, cols);
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

function padToCols(text: string, cols: number): string {
  const clipped = text.length > cols ? text.slice(0, cols) : text;
  return clipped + ' '.repeat(Math.max(0, cols - clipped.length));
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
