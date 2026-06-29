import { theme } from './theme.js';
import { size } from './screen.js';

export interface BoxOptions {
  title?: string;
  width?: number;
  style?: 'default' | 'command' | 'response';
  padding?: number;
}

/**
 * Render a GitHub Copilot CLI-style bordered panel.
 *
 *   ╭─ Copilot ────────────────╮
 *   │  content line            │
 *   ╰──────────────────────────╯
 */
export function box(content: string, opts: BoxOptions = {}): string {
  const cols = opts.width ?? Math.min(size().cols, 100);
  const pad = opts.padding ?? 1;
  const innerWidth = cols - 2; // subtract left/right border chars

  const title = opts.title ?? '';
  const topTitle = title ? ` ${title} ` : '';

  const topFill = innerWidth - topTitle.length;
  const topLeft = topFill < 0 ? 0 : Math.floor(topFill / 2);
  const topRight = topFill < 0 ? 0 : topFill - topLeft - (title ? 0 : 0);

  const top = `╭${'─'.repeat(topLeft)}${topTitle}${'─'.repeat(Math.max(0, topRight))}╮`;
  const bottom = `╰${'─'.repeat(innerWidth)}╯`;

  const lines = content.split('\n');
  const paddingStr = ' '.repeat(pad);
  const contentWidth = innerWidth - pad * 2;

  const bodyLines: string[] = [];
  for (const line of lines) {
    const stripped = stripAnsi(line);
    if (stripped.length <= contentWidth) {
      const fill = ' '.repeat(Math.max(0, contentWidth - stripped.length));
      const colored = line; // keep original ANSI
      bodyLines.push(`│${paddingStr}${colored}${fill}${paddingStr}│`);
    } else {
      // wrap long lines
      let remaining = line;
      let remainingStripped = stripped;
      while (remainingStripped.length > contentWidth) {
        const chunk = remaining.slice(0, contentWidth);
        const fill = ' '.repeat(Math.max(0, contentWidth - contentWidth));
        bodyLines.push(`│${paddingStr}${chunk}${fill}${paddingStr}│`);
        remaining = remaining.slice(contentWidth);
        remainingStripped = remainingStripped.slice(contentWidth);
      }
      if (remaining.length > 0) {
        const fill = ' '.repeat(Math.max(0, contentWidth - remainingStripped.length));
        bodyLines.push(`│${paddingStr}${remaining}${fill}${paddingStr}│`);
      }
    }
  }

  const styleTop =
    opts.style === 'command'
      ? theme.hl(top)
      : opts.style === 'response'
        ? theme.brand(top)
        : theme.dim(top);
  const styleBottom =
    opts.style === 'command'
      ? theme.hl(bottom)
      : opts.style === 'response'
        ? theme.brand(bottom)
        : theme.dim(bottom);
  const styleSide = (s: string) =>
    opts.style === 'command'
      ? theme.hl(s)
      : opts.style === 'response'
        ? theme.brand(s)
        : theme.dim(s);

  const styledBody = bodyLines.map((l) => {
    const left = l.slice(0, 1);
    const right = l.slice(-1);
    const mid = l.slice(1, -1);
    return `${styleSide(left)}${mid}${styleSide(right)}`;
  });

  return [styleTop, ...styledBody, styleBottom].join('\n') + '\n';
}

/** Single-line command display (compact version for inline command rendering). */
export function commandChip(cmd: string): string {
  return `${theme.hl('❯')} ${theme.hl(cmd)}`;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
