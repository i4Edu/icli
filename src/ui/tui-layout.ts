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
    '[Ctrl+C] Quit  │  [PageUp/Down] Scroll Output  │  [/] System Commands  │  ' +
    '[@] Target Context  │  [Ctrl+N/Ctrl+P] Cycle Follow-ups  │  [Esc] Clear';
  return `\x1b[2m${padVisible(legend, cols)}\x1b[0m`;
}

// ─── Split-view chrome ──────────────────────────────────────────────────────

const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

export interface HeaderInfo {
  online: boolean;
  mode: string;
  model: string;
  sessionId: string;
}

/**
 * Row 0 — the persistent header bar.
 *
 *   iCopilot CLI                         ● online · ask · gpt-4o-mini · #a1b2c3
 *
 * The product title is left-aligned and brightened; a compact status cluster
 * (connectivity dot, turn mode, model, short session id) is right-aligned.
 */
export function renderHeaderBar(info: HeaderInfo, cols: number): string {
  const title = `${BOLD}\x1b[94miCopilot CLI${RESET}`;
  const dot = info.online ? `${GREEN}●${RESET}` : `${RED}●${RESET}`;
  const statusText = `${info.online ? 'online' : 'offline'} · ${info.mode} · ${info.model} · #${info.sessionId.slice(0, 6)}`;
  const right = `${dot} ${GRAY}${statusText}${RESET}`;
  const titleWidth = visibleWidth(title);
  const rightWidth = visibleWidth(right);

  if (titleWidth + 1 + rightWidth > cols) {
    // Narrow terminal: keep the title, clip the status.
    const room = Math.max(0, cols - titleWidth - 1);
    const clipped = stripAnsi(right).slice(0, room);
    const gap = ' '.repeat(Math.max(0, cols - titleWidth - clipped.length));
    return `${title}${gap}${clipped}`;
  }
  const gap = ' '.repeat(cols - titleWidth - rightWidth);
  return `${title}${gap}${right}`;
}

export interface ContextPanelInfo {
  sessionId: string;
  model: string;
  mode: string;
  cwd: string;
  branch?: string;
  recentCommands: string[];
  logs?: string[];
}

/**
 * Right-hand contextual panel. Renders exactly `height` rows, each padded to
 * `width` visible columns, grouped into "Session", "Recent", and "Hints"
 * sections. Long values are clipped to the panel width.
 */
export function renderContextPanel(
  info: ContextPanelInfo,
  width: number,
  height: number,
): string[] {
  const lines: string[] = [];
  const heading = (text: string) => `${BOLD}${CYAN}${text}${RESET}`;
  const item = (label: string, value: string) => {
    const text = `  ${label} ${value}`;
    return stripAnsi(text).length > width
      ? `${GRAY}  ${label}${RESET} ${stripAnsi(value).slice(0, Math.max(0, width - label.length - 3))}`
      : `${GRAY}  ${label}${RESET} ${value}`;
  };

  lines.push(heading('Session'));
  lines.push(item('id    ', `#${info.sessionId.slice(0, 8)}`));
  lines.push(item('model ', info.model));
  lines.push(item('mode  ', info.mode));
  if (info.branch) lines.push(item('branch', info.branch));
  lines.push(item('cwd   ', shortenPath(info.cwd, width - 10)));
  lines.push('');

  lines.push(heading('Recent'));
  const recent = info.recentCommands.slice(-5).reverse();
  if (recent.length === 0) {
    lines.push(`${GRAY}  (no commands yet)${RESET}`);
  } else {
    for (const cmd of recent) {
      lines.push(`${GRAY}  ›${RESET} ${clip(cmd, width - 4)}`);
    }
  }

  if (info.logs && info.logs.length) {
    lines.push('');
    lines.push(heading('Logs'));
    for (const log of info.logs.slice(-4)) {
      lines.push(`${GRAY}  ${clip(log, width - 2)}${RESET}`);
    }
  }

  // Pad/clip to the exact panel height.
  const out = lines.slice(0, height);
  while (out.length < height) out.push('');
  return out.map((l) => padVisible(l, width));
}

/**
 * Compose two columns into `height` rows separated by a vertical divider.
 * Each side is padded/clipped to its own width so the divider stays aligned.
 */
export function composeColumns(
  left: string[],
  right: string[],
  leftWidth: number,
  rightWidth: number,
  height: number,
): string[] {
  const divider = `${GRAY}│${RESET}`;
  const rows: string[] = [];
  for (let i = 0; i < height; i++) {
    const l = padVisible(left[i] ?? '', leftWidth);
    const r = padVisible(right[i] ?? '', rightWidth);
    rows.push(`${l} ${divider} ${r}`);
  }
  return rows;
}

/**
 * Inline selectable follow-up chips: `[diagnose network] [optimize config]`.
 * The active chip (by index) is brightened; the others are dimmed. Returns an
 * empty string when there are no follow-ups.
 */
export function renderFollowups(items: string[], activeIndex: number, cols: number): string {
  if (!items.length) return '';
  const active = ((activeIndex % items.length) + items.length) % items.length;
  const chips = items.map((label, i) =>
    i === active ? `${BOLD}${GREEN}[${label}]${RESET}` : `${GRAY}[${label}]${RESET}`,
  );
  const prefix = `${GRAY}next:${RESET} `;
  const line = prefix + chips.join('  ');
  if (visibleWidth(line) > cols) {
    return padVisible(stripAnsi(line).slice(0, cols), cols);
  }
  return padVisible(line, cols);
}

function clip(text: string, max: number): string {
  const plain = stripAnsi(text);
  return plain.length > max ? plain.slice(0, Math.max(0, max - 1)) + '…' : plain;
}

function shortenPath(p: string, max: number): string {
  if (p.length <= max) return p;
  const parts = p.split('/');
  let out = p;
  while (out.length > max && parts.length > 2) {
    parts.splice(1, 1);
    out = parts[0] + '/…/' + parts.slice(1).join('/');
  }
  return out.length > max ? '…' + out.slice(out.length - max + 1) : out;
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
