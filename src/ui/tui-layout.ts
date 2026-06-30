/**
 * Pure, side-effect-free rendering helpers for the full-screen TUI.
 *
 * Every function returns a string (or array of strings) that is painted at an
 * absolute coordinate by the renderer in `modes/tui.ts`. Keeping these helpers
 * pure makes the visual geometry unit-testable without spawning a PTY.
 *
 * The colour language follows the modern engineering-agent CLIs:
 *   - deep blue (`\x1b[44m`) track for the tabbed navigation header
 *   - magenta (`\x1b[35m`) single line as the conversation/input boundary
 */

/** Workspace navigation contexts shown in the Row-0 tab bar. */
export const WORKSPACE_TABS = ['Session', 'Issues', 'Pull requests', 'Gists', 'Settings'] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const RESET = '\x1b[0m';
const BLUE_BG = '\x1b[44m';
const MAGENTA = '\x1b[35m';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** Remove ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Visible (printable) width of a string, ignoring ANSI escape sequences. */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Pad (or clip) a string to an exact visible width. Clipping is performed on
 * the plain text so we never emit a half-written escape sequence.
 */
export function padVisible(text: string, cols: number): string {
  const width = visibleWidth(text);
  if (width === cols) return text;
  if (width < cols) return text + ' '.repeat(cols - width);
  // Too long: fall back to the plain text and hard-clip it.
  return stripAnsi(text).slice(0, cols);
}

/**
 * Row 0 — the persistent tabbed navigation header.
 *
 *   [Session]   Issues   Pull requests   Gists   Settings
 *
 * The active tab is wrapped in brackets and brightened; the whole row sits on a
 * deep-blue background track that spans the full terminal width.
 */
export function renderTabBar(activeIndex: number, cols: number): string {
  const active =
    ((activeIndex % WORKSPACE_TABS.length) + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
  const gap = '   ';
  const plainParts = WORKSPACE_TABS.map((tab, i) => (i === active ? `[${tab}]` : ` ${tab} `));
  const plain = plainParts.join(gap);

  if (plain.length > cols) {
    // Degrade gracefully on narrow terminals: blue track + clipped plain text.
    return `${BLUE_BG}${plain.slice(0, cols)}${RESET}`;
  }

  const coloredParts = WORKSPACE_TABS.map((tab, i) =>
    i === active ? `\x1b[1;97m[${tab}]\x1b[22;39m` : `\x1b[2;37m ${tab} \x1b[22;39m`,
  );
  const colored = coloredParts.join(gap);
  const fill = ' '.repeat(Math.max(0, cols - plain.length));
  return `${BLUE_BG}${colored}${fill}${RESET}`;
}

export interface HeroInfo {
  version: string;
  provider: string;
  experimental?: string;
  tips?: string[];
}

/**
 * Section B — the left-aligned hero/branding canvas. Returns one string per
 * row so the renderer can place it line-by-line from the top of the timeline.
 */
export function renderHero(info: HeroInfo, cols: number): string[] {
  const bullet = '\x1b[35m●\x1b[0m';
  const lines: string[] = [];
  lines.push(
    padVisible(
      `\x1b[1miCopilot CLI Agent v${info.version}\x1b[0m  │  Provider: ${info.provider}`,
      cols,
    ),
  );
  if (info.experimental) {
    lines.push(padVisible(`Experimental Capabilities: ${info.experimental}`, cols));
  }
  lines.push(padVisible('', cols));
  for (const tip of info.tips ?? []) {
    lines.push(padVisible(`${bullet} ${tip}`, cols));
  }
  return lines;
}

/**
 * Section C — the horizontal status dock. The left context (cwd + git branch)
 * is left-aligned; the right context (usage metrics + model) is right-aligned.
 * When the two would overlap, the left side is clipped to preserve the metrics.
 */
export function renderStatusDock(left: string, right: string, cols: number): string {
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  // Right side alone fills or overflows the terminal — show only right side.
  if (rightWidth >= cols) {
    return stripAnsi(right).slice(0, cols);
  }

  if (leftWidth + 1 + rightWidth > cols) {
    const room = Math.max(0, cols - rightWidth - 1);
    const clippedLeft = stripAnsi(left).slice(0, room);
    const gap = ' '.repeat(Math.max(0, cols - clippedLeft.length - rightWidth));
    return `${clippedLeft}${gap}${right}`;
  }

  const gap = ' '.repeat(cols - leftWidth - rightWidth);
  return `${left}${gap}${right}`;
}

/** The full-width magenta boundary line that separates timeline from input. */
export function magentaSeparator(cols: number): string {
  return `${MAGENTA}${'─'.repeat(Math.max(0, cols))}${RESET}`;
}

/** Absolute bottom-row footer with the persistent keybinding legend. */
export function renderFooter(cols: number): string {
  const legend =
    '[Ctrl+C] Quit  │  [PageUp/Down] Scroll Output  │  [/] System Commands  │  [@] Target Context';
  return `\x1b[2m${padVisible(legend, cols)}\x1b[0m`;
}

export interface ParsedSlash {
  command: string;
  args: string[];
}

/**
 * Tokenise a slash command by splitting on whitespace thresholds rather than
 * fixed slices: `/model gpt-4o` → { command: 'model', args: ['gpt-4o'] }.
 */
export function parseSlashCommand(input: string): ParsedSlash | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [command, ...args] = trimmed.slice(1).split(/\s+/);
  if (!command) return null;
  return { command, args };
}
