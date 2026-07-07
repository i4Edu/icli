import React from 'react';
import { render } from 'ink';
import os from 'node:os';
import { createRequire } from 'node:module';
import simpleGit from 'simple-git';
import { loadAliases, resolveAlias } from '../commands/alias-cmd.js';
import { MetricsCollector } from '../commands/metrics-cmd.js';
import { handleSlash } from '../commands/slash.js';
import { Session } from '../session/session.js';
import { handlePostTurnContextBudget } from './auto-compact.js';
import { backgroundTaskManager } from './background.js';
import { runAutopilot } from './autopilot.js';
import { runTurn } from './turn.js';
import { hookManager } from '../hooks/lifecycle.js';
import { config } from '../config.js';
import { App, type AppCallbacks, type AppState, type TuiHandle } from '../ui/ink/App.js';
import { theme } from '../ui/theme.js';

const _require = createRequire(import.meta.url);
const VERSION: string = (_require('../../package.json') as { version: string }).version;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function cleanLabel(s: string): string {
  const link = s.match(/\[([^\]]+)\]\([^)]*\)/);
  const base = link ? link[1] : s;
  return base.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
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

  let gitBranch = '';
  try {
    const git = simpleGit(session.state.cwd);
    if (await git.checkIsRepo()) {
      gitBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    }
  } catch { /* not a git repo */ }

  const cwd = session.state.cwd.replace(os.homedir(), '~');

  const appState: AppState = {
    model: modelShort,
    provider: providerLabel,
    branch: gitBranch,
    cwd,
    version: VERSION,
  };

  let handle: TuiHandle | null = null;
  let currentAbort: AbortController | null = null;
  let busy = false;
  const pendingInputs: Array<{ line: string; scheduled: boolean }> = [];
  let msgSeq = 0;
  const nextId = () => `msg-${++msgSeq}`;

  // ── inkInstance forward-declared so handleLine can reference it ───────────
  let inkInstance: ReturnType<typeof render> | null = null;

  const handleLine = async (line: string, scheduled = false): Promise<void> => {
    if (busy) {
      pendingInputs.push({ line, scheduled });
      handle?.notify(
        scheduled ? `(system) queued: ${line}` : 'Still working — input queued.',
        'warn',
      );
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) return;

    busy = true;
    currentAbort = new AbortController();

    // Add frozen user message to Static history.
    handle?.addCompleted({
      id: nextId(),
      role: scheduled ? 'system' : 'user',
      content: line,
    });
    handle?.setBusy(true);

    const resolvedLine = resolveAlias(line, loadAliases()) ?? line;
    let plainAccumulator = '';

    // Intercept stdout: stream chunks into the live (non-Static) panel.
    const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;

    const interceptWrite = (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const plain = stripAnsi(text);
      plainAccumulator += plain;
      // Push each chunk to the live panel so it streams in real-time.
      handle?.appendLive(plain);
      if (typeof encodingOrCb === 'function') {
        return (originalWrite as (chunk: Uint8Array | string, cb?: (err?: Error | null) => void) => boolean)(chunk, encodingOrCb);
      }
      return (originalWrite as (chunk: Uint8Array | string, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean)(
        chunk, encodingOrCb as BufferEncoding | undefined, cb,
      );
    };

    try {
      process.stdout.write = interceptWrite as typeof process.stdout.write;

      const slash = await handleSlash(resolvedLine, {
        session,
        abort: currentAbort,
        metrics,
        schedulePrompt: (prompt) => void handleLine(prompt, true),
        exit: () => { inkInstance?.unmount(); },
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
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name !== 'AbortError' && !currentAbort?.signal.aborted) {
        await hookManager.emit('errorOccurred', {
          scope: 'tui',
          sessionId: session.state.id,
          message: e?.message || String(err),
        });
        handle?.addCompleted({
          id: nextId(),
          role: 'error',
          content: e?.message || String(err),
        });
      }
    } finally {
      process.stdout.write = originalWrite;
      currentAbort = null;
      busy = false;

      // Move live content to frozen history, clear the live panel.
      handle?.finishLive(plainAccumulator.trimEnd());
      handle?.setBusy(false);
      handle?.setTokenCount(session.tokenUsage());
      handle?.setFollowups(extractFollowups(plainAccumulator));

      const next = pendingInputs.shift();
      if (next) void handleLine(next.line, next.scheduled);
    }
  };

  const callbacks: AppCallbacks = {
    onLine: handleLine,
    onCancel: () => {
      if (currentAbort && !currentAbort.signal.aborted) {
        currentAbort.abort();
        handle?.notify('Turn cancelled.', 'warn');
      }
    },
    onExit: () => { inkInstance?.unmount(); },
  };

  inkInstance = render(
    React.createElement(App, {
      appState,
      callbacks,
      registerHandle: (h: TuiHandle) => { handle = h; },
    }),
    { exitOnCtrlC: false },
  );

  await inkInstance.waitUntilExit();

  await hookManager.emit('sessionEnd', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
  });
}
