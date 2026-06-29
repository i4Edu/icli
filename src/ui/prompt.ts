import readline from 'node:readline';
import { theme, safeUnicode } from './theme.js';
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

/**
 * Call this whenever content is written to stdout between two read() calls
 * (e.g. streamed LLM output) so we don't accidentally erase that content
 * when the next input box is rendered.
 */
export function invalidateBoxBottom(): void {
  pendingEraseLines = 0;
}

// ─── Slash command completer ───────────────────────────────────────────────
function slashCompleter(line: string): [string[], string] {
  const ctx = defaultContext();
  if (/^\/[\w-]*$/.test(line)) {
    const partial = line.slice(1).toLowerCase();
    const hits = ctx.slashCommands.filter((cmd) => cmd.startsWith(partial)).map((cmd) => `/${cmd}`);
    return [hits, line];
  }
  const subMatch = line.match(/^(\/[\w-]+)\s+(\S*)$/);
  if (subMatch) {
    const cmd = subMatch[1].slice(1);
    const partial = subMatch[2];
    const subs = ctx.slashSubcommands[cmd] ?? [];
    const hits = subs.filter((s) => s.startsWith(partial)).map((h) => `${subMatch[1]} ${h}`);
    if (hits.length) return [hits, line];
  }
  return [[], line];
}

// ─── Input box helpers ─────────────────────────────────────────────────────
const PLACEHOLDER = 'Enter @ to mention files or / for commands...';

function boxWidth(): number {
  return Math.max(60, (process.stdout.columns || 80) - 6);
}

// Track lines printed by drawBoxBottom() so the next read() can erase them
// before drawing a fresh top border (prevents infinite box stacking).
let pendingEraseLines = 0;

function drawBoxTop(): void {
  if (pendingEraseLines > 0 && process.stdout.isTTY) {
    // Erase the bottom border printed by the previous submission:
    //   drawBoxBottom writes "\n<border>\n" = 2 extra lines below the readline line.
    for (let i = 0; i < pendingEraseLines; i++) {
      process.stdout.write('\x1b[1A\x1b[2K'); // cursor up + clear line
    }
    pendingEraseLines = 0;
  }
  const w = boxWidth();
  const colorEnabled = theme.dim('') !== ''; // cheap color-enabled check
  const line = colorEnabled ? theme.dim(`  ╭${'─'.repeat(w)}╮`) : `  ╭${'─'.repeat(w)}╮`;
  process.stdout.write(line + '\n');
}

function drawBoxBottom(): void {
  const w = boxWidth();
  const line = theme.dim(`  ╰${'─'.repeat(w)}╯`);
  process.stdout.write('\n' + line + '\n');
  // Two lines were added below the readline line: the blank line (\n) and the
  // border line itself.  The trailing \n moves the cursor one further line down,
  // so we need to go back 2 lines on the next drawBoxTop() call.
  pendingEraseLines = 2;
}

// ─── Persistent footer (scroll-region docked) ──────────────────────────────
const FOOTER_KEYS = safeUnicode
  ? '  Ctrl+C Exit  │  Ctrl+R Clear History  │  Tab Autocomplete'
  : '  Ctrl+C Exit  |  Ctrl+R Clear History  |  Tab Autocomplete';

let footerInstalled = false;

function footerLine(cols: number): string {
  const text = FOOTER_KEYS;
  // Dim the key names and leave separators brighter
  const formatted = text
    .replace(/Ctrl\+[A-Z]/g, (m) => `\x1b[1m${m}\x1b[0m\x1b[2m`)
    .replace(/Tab/g, '\x1b[1mTab\x1b[0m\x1b[2m')
    .replace(/@file/g, '\x1b[1m@file\x1b[0m\x1b[2m');
  const pad = Math.max(0, cols - text.length);
  return `\x1b[2m${formatted}${' '.repeat(pad)}\x1b[0m`;
}

function installFooter(): void {
  if (!process.stdout.isTTY) return;
  const rows = process.stdout.rows ?? 24;
  const cols = process.stdout.columns ?? 80;
  // Reserve bottom 2 rows: separator + hotkey bar
  process.stdout.write(`\x1b[1;${rows - 2}r`); // set scroll region
  process.stdout.write('\x1b7'); // save cursor (DEC)
  process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K`);
  process.stdout.write(theme.dim('─'.repeat(cols)));
  process.stdout.write(`\x1b[${rows};1H\x1b[2K`);
  process.stdout.write(footerLine(cols));
  process.stdout.write('\x1b8'); // restore cursor (DEC)
  footerInstalled = true;
}

function removeFooter(): void {
  if (!footerInstalled) return;
  process.stdout.write('\x1b[r'); // reset scroll region to full terminal
  footerInstalled = false;
}

// ─── Main factory ──────────────────────────────────────────────────────────
export function createPrompt(keybindingMode?: KeybindingMode): ReplPrompt {
  const mode = keybindingMode ?? applyKeybindingConfig();
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let promptActive = false;
  let activeGhost = '';

  // Install the sticky footer + handle terminal resize
  if (isTTY) installFooter();

  const onResize = () => {
    if (isTTY && footerInstalled) {
      pendingEraseLines = 0; // can't reliably erase across a resize
      installFooter();
    }
  };
  process.on('SIGWINCH', onResize);
  // Also listen on stdout directly for environments that emit 'resize'
  // instead of (or in addition to) SIGWINCH (e.g. Windows ConPTY).
  if (isTTY) process.stdout.on('resize', onResize);

  // ── Ghost text helpers ────────────────────────────────────────────────
  const clearGhost = () => {
    if (!activeGhost || !isTTY) return;
    process.stdout.write(`${' '.repeat(activeGhost.length)}\x1b[${activeGhost.length}D`);
    activeGhost = '';
  };

  const drawGhost = (suffix: string) => {
    if (!suffix || !isTTY) return;
    activeGhost = suffix;
    process.stdout.write(`\x1b[2m${suffix}\x1b[0m\x1b[${suffix.length}D`);
  };

  // STEP 1 — clear ghost BEFORE readline redraws (prependListener fires first)
  const onKeypressClear = (_ch: unknown, key: readline.Key | undefined) => {
    if (!promptActive) return;
    if (key?.name === 'return' || key?.name === 'enter') return;
    clearGhost();
  };

  if (isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.prependListener('keypress', onKeypressClear);
  }

  // STEP 2 — readline (registers its own keypress handler after ours)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: isTTY ? slashCompleter : undefined,
    historySize: 500,
  });

  // STEP 3 — draw ghost AFTER readline finishes its redraw (setImmediate)
  const onKeypressDraw = (_ch: unknown, key: readline.Key | undefined) => {
    if (!promptActive || !isTTY) return;
    if (key?.ctrl || key?.meta) return;
    if (key?.name === 'return' || key?.name === 'enter' || key?.name === 'tab') return;
    if (key?.name === 'up' || key?.name === 'down') return;

    setImmediate(() => {
      if (!promptActive) return;
      const line: string = (rl as any).line ?? '';

      if (line === '') {
        drawGhost(PLACEHOLDER);
        return;
      }

      // Hint after a partial @mention: show "→ @<token>" in dim text.
      const atMatch = line.match(/@([\w./\\-]*)$/);
      if (atMatch) {
        drawGhost(atMatch[0].length > 1 ? '' : 'file/path');
        return;
      }

      if (!/^\/\w/.test(line)) return;

      const [hits] = slashCompleter(line);
      if (!hits.length) return;

      const ghost = hits[0].slice(line.length);
      if (!ghost) return;

      drawGhost(ghost);
    });
  };

  if (isTTY) process.stdin.on('keypress', onKeypressDraw);
  if (mode !== 'default') attachKeybindings(rl, mode);

  return {
    read(promptStr: string): Promise<string> {
      return new Promise((resolve) => {
        promptActive = true;
        drawBoxTop();
        rl.question(promptStr, (answer) => {
          promptActive = false;
          clearGhost();
          drawBoxBottom();
          resolve(answer);
        });
        // Show placeholder after readline renders the empty prompt
        setImmediate(() => {
          if (promptActive && !((rl as any).line as string)) {
            drawGhost(PLACEHOLDER);
          }
        });
      });
    },
    close() {
      promptActive = false;
      clearGhost();
      removeFooter();
      process.off('SIGWINCH', onResize);
      if (isTTY) {
        process.stdout.off('resize', onResize);
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

// ─── Prompt prefix (left border of input box) ─────────────────────────────
export function prefix(mode: 'ask' | 'plan'): string {
  const arrow = safeUnicode ? '❯' : '>';
  const border = theme.dim('│');
  if (mode === 'plan') {
    return `  ${border} ${theme.badge('plan')} ${theme.user(arrow)} `;
  }
  return `  ${border} ${theme.user(arrow)} `;
}
