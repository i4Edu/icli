import { theme } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

/**
 * A simple TTY spinner that renders a label next to a rotating braille frame.
 * Falls back to a plain text prefix when the terminal is not a TTY or when
 * Unicode / colours are disabled.
 */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = '';
  private readonly isTTY: boolean;

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  start(label: string): void {
    this.label = label;
    this.frame = 0;

    if (!this.isTTY) {
      process.stdout.write(`  … ${label}\n`);
      return;
    }

    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
  }

  update(label: string): void {
    this.label = label;
    if (!this.isTTY) {
      process.stdout.write(`  … ${label}\n`);
    }
  }

  stop(success = true): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isTTY) {
      // Overwrite the spinner line with a final status icon + label.
      process.stdout.write('\r\x1b[2K');
      const icon = success ? theme.ok('✔') : theme.err('✖');
      process.stdout.write(`  ${icon} ${this.label}\n`);
    }
  }

  private render(): void {
    const f = FRAMES[this.frame % FRAMES.length] ?? FRAMES[0]!;
    this.frame++;
    process.stdout.write(`\r\x1b[2K  ${theme.dim(f)} ${this.label}`);
  }
}
