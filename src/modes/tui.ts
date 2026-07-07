import readline from 'node:readline';
import os from 'node:os';
import simpleGit from 'simple-git';
import { loadAliases, resolveAlias } from '../commands/alias-cmd.js';
import { MetricsCollector } from '../commands/metrics-cmd.js';
import { handleSlash } from '../commands/slash.js';
import { Session } from '../session/session.js';
import { showCursor } from '../ui/screen.js';
import { Spinner } from '../ui/spinner.js';
import { safeUnicode, theme } from '../ui/theme.js';
import { handlePostTurnContextBudget } from './auto-compact.js';
import { backgroundTaskManager } from './background.js';
import { runAutopilot } from './autopilot.js';
import { runTurn } from './turn.js';
import { hookManager } from '../hooks/lifecycle.js';
import { config } from '../config.js';

const VERSION = '1.3.0';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BLUE = '\x1b[34m';
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');
const visW = (s: string) => stripAnsi(s).length;

function hRule(cols: number, color = GRAY): string {
  return `${color}${'─'.repeat(Math.max(0, cols))}${RESET}`;
}

function shortenHome(p: string): string {
  const h = os.homedir();
  return p === h || p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
}

function padRight(s: string, w: number): string {
  const v = visW(s);
  return v >= w ? s : s + ' '.repeat(w - v);
}

// ─── Welcome header ──────────────────────────────────────────────────────────

function printWelcome(model: string, provider: string, branch: string): void {
  const cols = process.stdout.columns || 80;
  const cwd = shortenHome(process.cwd());
  const branchPart = branch
    ? `  ${GRAY}${safeUnicode ? '\uE0A0' : 'git:'} ${branch}${RESET}`
    : '';

  process.stdout.write('\n');
  process.stdout.write(hRule(cols, MAGENTA) + '\n');
  process.stdout.write(
    `  ${BOLD}${CYAN}iCopilot CLI${RESET}  ${DIM}v${VERSION}${RESET}  ${GRAY}·${RESET}  ` +
      `${BOLD}${model}${RESET}  ${GRAY}·${RESET}  ${BLUE}${provider}${RESET}\n`,
  );
  process.stdout.write(`  ${GRAY}${cwd}${branchPart}${RESET}\n`);
  process.stdout.write(
    `  ${DIM}${GRAY}/help${RESET}${DIM} commands · ${RESET}${GRAY}@file${RESET}` +
      `${DIM} context · ${RESET}${GRAY}Ctrl+C${RESET}${DIM} quit${RESET}\n`,
  );
  process.stdout.write(hRule(cols, MAGENTA) + '\n\n');
}

// ─── Follow-up chips ─────────────────────────────────────────────────────────

function cleanLabel(s: string): string {
  const link = s.match(/\[([^\]]+)\]\([^)]*\)/);
  const base = link ? link[1] : s;
  return base
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

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

function printFollowups(chips: string[], activeIndex: number): void {
  if (!chips.length) return;
  const cols = process.stdout.columns || 80;
  const active = ((activeIndex % chips.length) + chips.length) % chips.length;
  const parts = chips.map((c, i) =>
    i === active ? `${BOLD}${GREEN}[${c}]${RESET}` : `${GRAY}[${c}]${RESET}`,
  );
  const line = `  ${DIM}Next:${RESET}  ` + parts.join('  ');
  const hint = `  ${DIM}↵ run  Ctrl+N/P cycle  Esc dismiss${RESET}`;
  process.stdout.write(
    '\n' + (visW(line) > cols ? stripAnsi(line).slice(0, cols) : line) + '\n',
  );
  process.stdout.write(hint + '\n');
}

// ─── Status footer after each turn ───────────────────────────────────────────

function printStatusLine(model: string, tokens: number): void {
  const cols = process.stdout.columns || 80;
  const right = `${GRAY}${model}  ·  ~${Math.round(tokens / 1000)}k ctx${RESET}`;
  process.stdout.write(padRight('', Math.max(0, cols - visW(right))) + right + '\n');
}

// ─── Main TUI ────────────────────────────────────────────────────────────────

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
  const modelShort = session.state.model.replace('openai/', '').replace('github/', '');
  const providerLabel = config.provider || 'github';

  // Resolve git branch once at startup.
  let gitBranch = '';
  try {
    const git = simpleGit(session.state.cwd);
    if (await git.checkIsRepo()) {
      gitBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    }
  } catch {
    /* not a git repo */
  }

  printWelcome(modelShort, providerLabel, gitBranch);

  let running = true;
  let busy = false;
  let followups: string[] = [];
  let followupIndex = 0;
  let currentAbort: AbortController | null = null;
  const pendingInputs: Array<{ line: string; scheduled: boolean }> = [];
  const spinner = new Spinner();

  // readline uses process.stdout directly — no silent sink, no alt-screen.
  readline.emitKeypressEvents(process.stdin);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '',
  });

  const showPrompt = () => {
    if (!running) return;
    process.stdout.write(`${GREEN}❯${RESET} `);
  };

  // ── Handle each user turn ──────────────────────────────────────────────
  const handleLine = async (line: string, scheduled = false): Promise<void> => {
    if (busy) {
      pendingInputs.push({ line, scheduled });
      process.stdout.write(
        `  ${GRAY}${scheduled ? '(system) queued:' : 'Still working — queued:'} ${line}${RESET}\n`,
      );
      return;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      // Empty Enter while followups exist → run active chip.
      if (followups.length) {
        const idx = ((followupIndex % followups.length) + followups.length) % followups.length;
        const choice = followups[idx];
        followups = [];
        followupIndex = 0;
        void handleLine(choice);
        return;
      }
      showPrompt();
      return;
    }

    busy = true;
    currentAbort = new AbortController();
    followups = [];
    followupIndex = 0;

    // Echo the user message.
    const cols = process.stdout.columns || 80;
    process.stdout.write('\n' + hRule(cols, GRAY) + '\n');
    const speaker = scheduled
      ? `${GRAY}⏱ System${RESET}`
      : `${BOLD}${BLUE}You${RESET}`;
    process.stdout.write(`${speaker}\n${line}\n`);
    process.stdout.write(hRule(cols, GRAY) + '\n\n');

    // "● Copilot" header before streaming response.
    process.stdout.write(`${BOLD}${MAGENTA}●${RESET} ${BOLD}Copilot${RESET}\n`);
    spinner.start('Thinking…');

    const resolvedLine = resolveAlias(line, loadAliases()) ?? line;
    let lastOutput = '';

    // Intercept stdout to harvest followups while letting output flow through.
    const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
    const interceptWrite = (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      lastOutput += stripAnsi(text);
      if (typeof encodingOrCb === 'function') {
        return (
          originalWrite as (
            chunk: Uint8Array | string,
            cb?: (err?: Error | null) => void,
          ) => boolean
        )(chunk, encodingOrCb);
      }
      return (
        originalWrite as (
          chunk: Uint8Array | string,
          encoding?: BufferEncoding,
          cb?: (err?: Error | null) => void,
        ) => boolean
      )(chunk, encodingOrCb as BufferEncoding | undefined, cb);
    };

    try {
      process.stdout.write = interceptWrite as typeof process.stdout.write;

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
        const trimmedForward = forwardInput.trim();

        if (trimmedForward.endsWith('&')) {
          const goal = trimmedForward.slice(0, -1).trim();
          if (!goal) {
            process.stdout.write('usage: <prompt> &\n');
          } else {
            const id = backgroundTaskManager.startTask(goal);
            process.stdout.write(
              `${theme.ok('✔')} background task ${id.slice(0, 8)}: ${goal}\n`,
            );
          }
        } else {
          const explicitTurnMode = (
            slash as { turnMode?: 'ask' | 'code' | 'architect' | 'reason' | null }
          ).turnMode;
          const effectiveTurnMode = explicitTurnMode ?? opts.defaultTurnMode;

          if (session.state.autopilotEnabled && !effectiveTurnMode) {
            await runAutopilot(forwardInput, { session, signal: currentAbort.signal });
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
      }

      process.stdout.write = originalWrite;
      spinner.stop(true);
    } catch (err: unknown) {
      process.stdout.write = originalWrite;
      spinner.stop(false);
      const e = err as { name?: string; message?: string };
      if (e?.name !== 'AbortError' && !currentAbort?.signal.aborted) {
        await hookManager.emit('errorOccurred', {
          scope: 'tui',
          sessionId: session.state.id,
          message: e?.message || String(err),
        });
        process.stdout.write(`\n${theme.err('✖')} ${e?.message || String(err)}\n`);
      }
    } finally {
      currentAbort = null;
      busy = false;

      followups = extractFollowups(lastOutput);
      if (followups.length) printFollowups(followups, followupIndex);

      const cols2 = process.stdout.columns || 80;
      process.stdout.write('\n' + hRule(cols2, GRAY) + '\n');
      printStatusLine(modelShort, session.tokenUsage());
      process.stdout.write('\n');

      const next = pendingInputs.shift();
      if (next) {
        void handleLine(next.line, next.scheduled);
      } else if (!running) {
        rl.close();
      } else {
        showPrompt();
      }
    }
  };

  // ── Keypress: navigation + Ctrl+C ─────────────────────────────────────
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on('keypress', (_ch: unknown, key: readline.Key | undefined) => {
    if (!key) return;
    if (key.ctrl && key.name === 'c') {
      if (busy && currentAbort && !currentAbort.signal.aborted) {
        currentAbort.abort();
        process.stdout.write(`\n${theme.warn('⚠')}  Turn cancelled.\n\n`);
        return;
      }
      running = false;
      rl.close();
      showCursor();
      process.stdout.write('\n');
      process.exit(0);
    }
    if (key.ctrl && key.name === 'n' && followups.length) {
      followupIndex = (followupIndex + 1) % followups.length;
      printFollowups(followups, followupIndex);
    } else if (key.ctrl && key.name === 'p' && followups.length) {
      followupIndex = (followupIndex - 1 + followups.length) % followups.length;
      printFollowups(followups, followupIndex);
    } else if (key.name === 'escape') {
      followups = [];
      followupIndex = 0;
    }
  });

  rl.on('line', (line) => void handleLine(line));
  rl.on('close', () => {
    running = false;
    showCursor();
  });

  showPrompt();

  // Wait until session ends.
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    rl.once('close', done);
    const poll = setInterval(() => {
      if (!running && !busy) {
        clearInterval(poll);
        rl.off('close', done);
        resolve();
      }
    }, 100);
    void poll;
  });

  await hookManager.emit('sessionEnd', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
  });
}
