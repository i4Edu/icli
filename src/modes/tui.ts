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
  renderHero,
  renderStatusDock,
  magentaSeparator,
  renderFooter,
  renderHeaderBar,
  renderContextPanel,
  composeColumns,
  renderFollowups,
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
  opts: { defaultTurnMode?: 'ask' | 'code' | 'architect' | 'reason' } = {},
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
  const recentCommands: string[] = [];
  let followups: string[] = [];
  let followupIndex = 0;
  let lastTurnOutput = '';
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
    //   row 1                 → header bar (title + status cluster)
    //   rows 2..dockRow-1     → split view: left output stream │ right context panel
    //   dockRow               → status dock (locked 3 rows above the bottom)
    //   dockRow + 1           → follow-up chips (or magenta boundary)
    //   dockRow + 2           → input dock
    //   rows (bottom)         → persistent footer
    const headerRow = 1;
    const chatTop = 2;
    // The status dock is locked exactly 3 rows above the absolute bottom, so the
    // four bottom rows are: dock, follow-ups/separator, input dock, footer.
    const dockRow = Math.max(chatTop, rows - 3);
    const separatorRow = Math.min(dockRow + 1, rows);
    const inputRow = Math.min(dockRow + 2, rows);
    const footerRow = Math.min(dockRow + 3, rows);
    const chatBottom = dockRow - 1;
    const chatHeight = Math.max(1, chatBottom - chatTop + 1);

    // Column geometry: left output stream takes the bulk, the contextual panel
    // claims a slim fixed-ish right column (3 cols reserved for " │ ").
    const rightWidth = Math.max(18, Math.min(34, Math.floor(cols * 0.3)));
    const leftWidth = Math.max(20, cols - rightWidth - 3);

    writeRaw('\x1b[2J\x1b[H');

    const modelShort = session.state.model.replace('openai/', '').replace('github/', '');

    // Row 1 — header bar.
    writeRaw(`\x1b[${headerRow};1H`);
    writeRaw(
      renderHeaderBar(
        { online: !busy, mode: session.state.mode, model: modelShort, sessionId: session.state.id },
        cols,
      ),
    );

    // Split view — left output/input stream, right contextual panel.
    const showHero = !chat.trim();
    const leftSource = showHero
      ? heroCanvas(session, leftWidth)
      : wrapLines(chat.trimEnd(), Math.max(1, leftWidth));
    const leftLines = leftSource.slice(-chatHeight);

    const rightLines = renderContextPanel(
      {
        sessionId: session.state.id,
        model: modelShort,
        mode: session.state.mode,
        cwd: session.state.cwd,
        branch: gitBranch,
        recentCommands,
      },
      rightWidth,
      chatHeight,
    );

    const splitRows = composeColumns(leftLines, rightLines, leftWidth, rightWidth, chatHeight);
    for (let i = 0; i < chatHeight; i++) {
      writeRaw(`\x1b[${chatTop + i};1H`);
      writeRaw(splitRows[i] ?? '');
    }

    // Status dock — left: cwd + branch, right: live consumption metrics.
    writeRaw(`\x1b[${dockRow};1H`);
    writeRaw(statusDock(session, gitBranch, cols, busy));

    // Follow-up chips line (falls back to the magenta boundary when empty).
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
    } else if (followups.length) {
      writeRaw('\x1b[2K');
      writeRaw(renderFollowups(followups, followupIndex, cols));
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
    const plain = stripAnsi(text);
    chat += plain;
    lastTurnOutput += plain;
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

    if (!scheduled) {
      recentCommands.push(trimmed);
      if (recentCommands.length > 20) recentCommands.shift();
    }

    busy = true;
    currentAbort = new AbortController();
    lastTurnOutput = '';
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

        const explicitTurnMode = (
          slash as { turnMode?: 'ask' | 'code' | 'architect' | 'reason' | null }
        ).turnMode;
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
      followups = extractFollowups(lastTurnOutput);
      followupIndex = 0;
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
  rl.on('line', (line) => {
    if (!line.trim() && followups.length) {
      const idx = ((followupIndex % followups.length) + followups.length) % followups.length;
      const choice = followups[idx];
      followups = [];
      followupIndex = 0;
      void handleLine(choice);
      return;
    }
    void handleLine(line);
  });
  rl.on('close', () => {
    if (running) cleanup();
  });
  const onKeypress = (_ch: unknown, key: readline.Key | undefined) => {
    // Ctrl+N / Ctrl+P cycle the inline follow-up chips; Esc clears them.
    if (key?.ctrl && key.name === 'n' && followups.length) {
      followupIndex = (followupIndex + 1) % followups.length;
    } else if (key?.ctrl && key.name === 'p' && followups.length) {
      followupIndex = (followupIndex - 1 + followups.length) % followups.length;
    } else if (key?.name === 'escape') {
      followups = [];
      followupIndex = 0;
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

function cleanLabel(s: string): string {
  // For markdown links like [label](ca://s?q=…), use only the link text.
  const link = s.match(/\[([^\]]+)\]\([^)]*\)/);
  const base = link ? link[1] : s;
  return base.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/**
 * Derive selectable follow-up actions from a completed turn's output. Prefers a
 * markdown "Next steps" list, falling back to inline `[chip]` style suggestions.
 */
function extractFollowups(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  let collecting = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{0,3}\s*next steps?\b/i.test(line) || /^next steps?:/i.test(line)) {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    const m = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
    if (m) {
      const label = cleanLabel(m[1]);
      if (label) out.push(label);
      if (out.length >= 4) break;
    } else if (line !== '') {
      break;
    }
  }
  if (out.length) return out;

  const chip = /\[([^\]\n]{2,40})\]/g;
  let match: RegExpExecArray | null;
  while ((match = chip.exec(text)) !== null && out.length < 4) {
    const label = cleanLabel(match[1]);
    if (label && !/https?:|\.(md|ts|js|json)$/i.test(label)) out.push(label);
  }
  return out;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
