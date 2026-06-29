import chalk, { Chalk, supportsColor } from 'chalk';
import type { ChalkInstance } from 'chalk';
import { config, type ThemeName } from '../config.js';

type Styler = (text: string) => string;

const plain: Styler = (text) => text;

function colorEnabled(): boolean {
  if (config.theme === 'none') return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (process.env.NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  return Boolean(supportsColor || chalk.level > 0);
}

function palette(): { c: ChalkInstance; name: ThemeName } {
  const c = colorEnabled() ? chalk : new Chalk({ level: 0 });
  return { c, name: config.theme === 'light' ? 'light' : 'dark' };
}

function style(fn: (c: ChalkInstance, name: ThemeName) => Styler): Styler {
  return (text) => {
    if (!colorEnabled()) return text;
    const p = palette();
    return fn(p.c, p.name)(text);
  };
}

export function selectTheme(): ThemeName {
  return config.theme;
}

export const theme: Record<string, Styler> & { badge: Styler } = {
  brand: style((c, name) => (name === 'light' ? c.hex('#0F6CBD').bold : c.hex('#58A6FF').bold)),
  user: style((c, name) => (name === 'light' ? c.hex('#0F6CBD').bold : c.hex('#58A6FF').bold)),
  assistant: style((c, name) => (name === 'light' ? c.green.bold : c.green)),
  system: style((c) => c.gray.italic),
  warn: style((c, name) => (name === 'light' ? c.hex('#92400E') : c.yellow)),
  err: style((c) => c.red.bold),
  ok: style((c, name) => (name === 'light' ? c.hex('#166534').bold : c.green.bold)),
  dim: style((c) => c.gray),
  hl: style((c, name) => (name === 'light' ? c.hex('#0A5CA8') : c.hex('#79C0FF'))),
  ghost: style((c) => c.gray.dim),
  hint: style((c) => c.gray.italic),
  badge: (s: string) => {
    if (!colorEnabled()) return `[${s}]`;
    const p = palette();
    return p.name === 'light'
      ? p.c.bgHex('#0F6CBD').white.bold(` ${s} `)
      : p.c.bgHex('#1F6FEB').white.bold(` ${s} `);
  },
};

const safeUnicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);

export function banner(version: string, model: string): string {
  if (!colorEnabled()) {
    return `\niCopilot  v${version}  model: ${model}\n/help · @file · Tab to autocomplete\n\n`;
  }

  const { c, name } = palette();
  const blue = name === 'light' ? '#0F6CBD' : '#58A6FF';
  const boxColor = (s: string) => c.hex(blue)(s);
  const dim = (s: string) => c.gray(s);
  const hl = (s: string) => c.hex(name === 'light' ? '#0A5CA8' : '#79C0FF')(s);

  // Box dimensions
  const icon = safeUnicode ? '⬡' : '*';
  const title = `${icon}  iCopilot`;
  const versionStr = `v${version}`;
  const modelStr = model;
  const innerWidth = Math.max(title.length + versionStr.length + 4, modelStr.length + 4, 34);

  const top    = boxColor(`╭${'─'.repeat(innerWidth + 2)}╮`);
  const bottom = boxColor(`╰${'─'.repeat(innerWidth + 2)}╯`);
  const side   = boxColor('│');

  const padLine = (left: string, right: string, rawLeft: number, rawRight: number) => {
    const gap = innerWidth - rawLeft - rawRight;
    return `${side} ${left}${' '.repeat(Math.max(0, gap))}${right} ${side}`;
  };

  const row1Left  = c.hex(blue).bold(title);
  const row1Right = dim(versionStr);
  const row1 = padLine(row1Left, row1Right, title.length, versionStr.length);

  const row2Left  = dim('model: ') + hl(modelStr);
  const row2 = padLine(row2Left, '', `model: `.length + modelStr.length, 0);

  const hints = safeUnicode
    ? `${dim('/help')} for commands  ${dim('@file')} to add context  ${dim('Tab')} to autocomplete`
    : `/help for commands  @file to add context  Tab to autocomplete`;

  return [
    '',
    `  ${top}`,
    `  ${row1}`,
    `  ${row2}`,
    `  ${bottom}`,
    '',
    `  ${hints}`,
    '',
  ].join('\n');
}
