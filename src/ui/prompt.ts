import readline from 'node:readline';
import { theme } from './theme.js';
import { defaultContext } from '../util/completion.js';
import {
  attachKeybindings,
  applyKeybindingConfig,
  type KeybindingMode,
} from '../util/keybindings.js';

export interface ReplPrompt {
  read(prompt: string): Promise<string>;
  close(): void;
  getKeybindingMode?(): KeybindingMode;
}

/** Returns matching slash completions for readline Tab completion and ghost text. */
function slashCompleter(line: string): [string[], string] {
  const ctx = defaultContext();

  // /command — at least one char after slash for ghost text, full list for Tab
  if (/^\/[\w-]*$/.test(line)) {
    const partial = line.slice(1).toLowerCase();
    const hits = ctx.slashCommands
      .filter((cmd) => cmd.startsWith(partial))
      .map((cmd) => `/${cmd}`);
    return [hits, line];
  }

  // /command subcommand — e.g. /memory li
  const subMatch = line.match(/^(\/[\w-]+)\s+(\S*)$/);
  if (subMatch) {
    const cmd = subMatch[1].slice(1);
    const partial = subMatch[2];
    const subs = ctx.slashSubcommands[cmd] ?? [];
    const hits = subs
      .filter((s) => s.startsWith(partial))
      .map((h) => `${subMatch[1]} ${h}`);
    if (hits.length) return [hits, line];
  }

  return [[], line];
}

/** Prompt with ghost-text suggestions for slash commands and Tab completion. */
export function createPrompt(keybindingMode?: KeybindingMode): ReplPrompt {
  const mode = keybindingMode ?? applyKeybindingConfig();
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let promptActive = false;
  let activeGhost = '';

  // Erase the currently visible ghost text (spaces + cursor back).
  const clearGhost = () => {
    if (!activeGhost || !isTTY) return;
    process.stdout.write(`${' '.repeat(activeGhost.length)}\x1b[${activeGhost.length}D`);
    activeGhost = '';
  };

  // Write dim ghost text after cursor, then move cursor back so it stays on the typed text.
  const drawGhost = (suffix: string) => {
    if (!suffix || !isTTY) return;
    activeGhost = suffix;
    process.stdout.write(`\x1b[2m${suffix}\x1b[0m\x1b[${suffix.length}D`);
  };

  // STEP 1 — clear ghost BEFORE readline rewrites the line (prependListener fires first).
  const onKeypressClear = (_ch: unknown, key: readline.Key | undefined) => {
    if (!promptActive) return;
    if (key?.name === 'return' || key?.name === 'enter') return;
    clearGhost();
  };

  if (isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.prependListener('keypress', onKeypressClear);
  }

  // STEP 2 — create readline (registers its own keypress handler after ours).
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: isTTY ? slashCompleter : undefined,
    historySize: 500,
  });

  // STEP 3 — draw ghost AFTER readline finishes its redraw (setImmediate).
  const onKeypressDraw = (_ch: unknown, key: readline.Key | undefined) => {
    if (!promptActive || !isTTY) return;
    if (key?.ctrl || key?.meta) return;
    if (key?.name === 'return' || key?.name === 'enter' || key?.name === 'tab') return;
    if (key?.name === 'up' || key?.name === 'down') return;

    setImmediate(() => {
      if (!promptActive) return;
      const line: string = (rl as any).line ?? '';

      // Only suggest when user has typed at least one char after /
      if (!/^\/\w/.test(line)) return;

      const [hits] = slashCompleter(line);
      if (!hits.length) return;

      const ghost = hits[0].slice(line.length);
      if (!ghost) return;

      drawGhost(ghost);
    });
  };

  if (isTTY) {
    process.stdin.on('keypress', onKeypressDraw);
  }

  if (mode !== 'default') {
    attachKeybindings(rl, mode);
  }

  return {
    read(prompt: string): Promise<string> {
      return new Promise((resolve) => {
        promptActive = true;
        rl.question(prompt, (answer) => {
          promptActive = false;
          clearGhost();
          resolve(answer);
        });
      });
    },
    close() {
      promptActive = false;
      clearGhost();
      if (isTTY) {
        process.stdin.removeListener('keypress', onKeypressClear);
        process.stdin.removeListener('keypress', onKeypressDraw);
      }
      rl.close();
    },
    getKeybindingMode() {
      return mode;
    },
  };
}

const safeUnicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);

export function prefix(mode: 'ask' | 'plan'): string {
  const arrow = safeUnicode ? '❯' : '>';
  if (mode === 'plan') {
    return `${theme.badge('plan')} ${theme.user(arrow)} `;
  }
  return `${theme.user(arrow)} `;
}
