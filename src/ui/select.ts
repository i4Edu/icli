import readline from 'node:readline';
import { theme, safeUnicode } from './theme.js';

const CURSOR = safeUnicode ? '❯' : '>';
const BLANK = ' ';

/**
 * Render an interactive arrow-key selection menu.
 *
 * @param choices   List of option labels to display.
 * @param initial   Initially selected index (default 0).
 * @returns         Resolves with the index of the chosen option, or -1 if
 *                  the user pressed Escape / Ctrl-C.
 *
 * Example:
 *   ❯ Run this command
 *     Revise command instructions
 *     Abort operation
 */
export async function selectMenu(choices: string[], initial = 0): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Non-interactive: auto-select the first option.
    return 0;
  }

  return new Promise((resolve) => {
    let selected = Math.max(0, Math.min(initial, choices.length - 1));

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setRawMode(true);

    const render = () => {
      // Erase all previously drawn lines.
      for (let i = 0; i < choices.length; i++) {
        process.stdout.write('\x1b[2K\r');
        if (i < choices.length - 1) process.stdout.write('\x1b[1A');
      }
      // Re-draw.
      for (let i = 0; i < choices.length; i++) {
        const active = i === selected;
        const cursor = active ? theme.brand(CURSOR) : BLANK;
        const label = active ? choices[i] : theme.dim(choices[i] ?? '');
        process.stdout.write(`  ${cursor} ${label}`);
        if (i < choices.length - 1) process.stdout.write('\n');
      }
    };

    // Draw initial menu.
    process.stdout.write('\n');
    for (const choice of choices) {
      process.stdout.write(`  ${BLANK} ${theme.dim(choice)}\n`);
    }
    // Move cursor back up to rewrite from the first line.
    for (let i = 0; i < choices.length; i++) {
      process.stdout.write('\x1b[1A');
    }
    render();

    const onKeypress = (_ch: unknown, key: readline.Key | undefined) => {
      if (!key) return;

      if (key.name === 'up') {
        selected = (selected - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down') {
        selected = (selected + 1) % choices.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup(selected);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup(-1);
      }
    };

    const cleanup = (result: number) => {
      process.stdin.removeListener('keypress', onKeypress);
      if (!wasRaw) process.stdin.setRawMode(false);
      process.stdout.write('\n');
      resolve(result);
    };

    process.stdin.on('keypress', onKeypress);
  });
}
