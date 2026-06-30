import os from 'node:os';
import chalk, { Chalk, supportsColor } from 'chalk';
import type { ChalkInstance } from 'chalk';
import { config, type ThemeName } from '../config.js';

type Styler = (text: string) => string;

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
  brand: style((c, n) => (n === 'light' ? c.hex('#0F6CBD').bold : c.hex('#58A6FF').bold)),
  user: style((c, n) => (n === 'light' ? c.hex('#0F6CBD').bold : c.hex('#58A6FF').bold)),
  assistant: style((c, n) => (n === 'light' ? c.green.bold : c.green)),
  system: style((c) => c.gray.italic),
  warn: style((c, n) => (n === 'light' ? c.hex('#92400E') : c.yellow)),
  err: style((c) => c.red.bold),
  ok: style((c, n) => (n === 'light' ? c.hex('#166534').bold : c.green.bold)),
  dim: style((c) => c.gray),
  hl: style((c, n) => (n === 'light' ? c.hex('#0A5CA8') : c.hex('#79C0FF'))),
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

export const safeUnicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function shortenHome(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

/**
 * GitHub Copilot CLI-style welcome panel. Renders a rounded, bordered box
 * with the product title, model/provider, working directory, and the core
 * shortcut hints — mirroring the official Copilot CLI launch screen.
 */
export function banner(version: string, model: string, sessionDir?: string): string {
  void sessionDir;
  const cols = process.stdout.columns || 80;
  const corner = safeUnicode
    ? { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }
    : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  const indent = '  ';
  const width = Math.max(60, cols - 6);
  const cwd = shortenHome(process.cwd());

  if (!colorEnabled()) {
    const top = `${indent}${corner.tl}${corner.h.repeat(width)}${corner.tr}`;
    const bottom = `${indent}${corner.bl}${corner.h.repeat(width)}${corner.br}`;
    const row = (text: string) =>
      `${indent}${corner.v} ${text}${' '.repeat(Math.max(0, width - 1 - text.length))}${corner.v}`;
    return [
      '',
      top,
      row(`iCopilot CLI  v${version}`),
      row(''),
      row('Ask me to build, edit, explain, or run code in this repo.'),
      row(`model ${model}   provider GitHub Models`),
      row(`cwd ${cwd}`),
      row(''),
      row('/help for commands   @file to add context   /exit to quit'),
      bottom,
      '',
    ].join('\n');
  }

  const { c } = palette();
  const blue = '#58A6FF';
  const border = (s: string) => c.gray(s);
  const dim = (s: string) => c.gray(s);
  const top = `${indent}${border(`${corner.tl}${corner.h.repeat(width)}${corner.tr}`)}`;
  const bottom = `${indent}${border(`${corner.bl}${corner.h.repeat(width)}${corner.br}`)}`;
  const row = (text: string) => {
    const pad = ' '.repeat(Math.max(0, width - 1 - visibleLength(text)));
    return `${indent}${border(corner.v)} ${text}${pad}${border(corner.v)}`;
  };

  const title = `${c.hex(blue).bold('iCopilot CLI')}  ${dim('v' + version)}`;
  const meta = `${dim('model')} ${c.hex(blue)(model)}   ${dim('provider')} ${c.hex(blue)('GitHub Models')}`;
  const hints =
    `${c.bold('/help')} ${dim('for commands')}   ` +
    `${c.bold('@file')} ${dim('to add context')}   ` +
    `${c.bold('/exit')} ${dim('to quit')}`;

  return [
    '',
    top,
    row(title),
    row(''),
    row('Ask me to build, edit, explain, or run code in this repo.'),
    row(meta),
    row(`${dim('cwd')} ${dim(cwd)}`),
    row(''),
    row(hints),
    bottom,
    '',
  ].join('\n');
}
