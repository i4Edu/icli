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
  brand: style((c, name) => (name === 'light' ? c.hex('#5B21B6').bold : c.hex('#7C3AED').bold)),
  user: style((c, name) => (name === 'light' ? c.blue.bold : c.cyan.bold)),
  assistant: style((c, name) => (name === 'light' ? c.green.bold : c.green)),
  system: style((c) => c.gray.italic),
  warn: style((c, name) => (name === 'light' ? c.hex('#92400E') : c.yellow)),
  err: style((c) => c.red.bold),
  ok: style((c, name) => (name === 'light' ? c.hex('#166534').bold : c.green.bold)),
  dim: style((c) => c.gray),
  hl: style((c, name) => (name === 'light' ? c.hex('#B45309') : c.hex('#FBBF24'))),
  badge: (s: string) => {
    if (!colorEnabled()) return ` ${s} `;
    const p = palette();
    return p.name === 'light'
      ? p.c.bgHex('#5B21B6').white.bold(` ${s} `)
      : p.c.bgHex('#7C3AED').white.bold(` ${s} `);
  },
};

export function banner(version: string, model: string): string {
  const title = theme.brand('iCopilot');
  const sep = colorEnabled() ? '•' : '-';
  const sub = theme.dim(`v${version}  ${sep}  model: ${theme.hl(model)}`);
  return `\n${title}  ${sub}\n${theme.dim(
    'Type /help for commands. @file to inject a file. Ctrl-C to interrupt.',
  )}\n`;
}
