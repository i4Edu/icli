export const ESC = '\x1b[';

export const altScreenEnter = () => process.stdout.write('\x1b[?1049h');
export const altScreenExit = () => process.stdout.write('\x1b[?1049l');
export const clear = () => process.stdout.write('\x1b[2J\x1b[H');
export const moveTo = (row: number, col: number) => process.stdout.write(`\x1b[${row};${col}H`);
export const hideCursor = () => process.stdout.write('\x1b[?25l');
export const showCursor = () => process.stdout.write('\x1b[?25h');

export function size(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}
