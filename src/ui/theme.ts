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

export function banner(version: string, model: string, sessionDir?: string): string {
  const sessDir = sessionDir ?? '~/.icopilot/sessions/';
  const hintSegments = ['/help commands', 'type / for slash hints', '@file context'] as const;
  const plainHints = hintSegments.join('  ');
  if (!colorEnabled()) {
    return [
      '',
      `iCopilot CLI Agent v${version}  |  Provider: GitHub Models`,
      `Session: active (${sessDir})  |  Model: ${model}`,
      '/help for commands · / for slash hints · @file to add context',
      '',
    ].join('\n');
  }

  const { c, name } = palette();
  const green = name === 'light' ? '#166534' : '#3FB950';
  const blue = '#58A6FF';

  const title = `${c.hex(blue).bold('iCopilot CLI Agent')} ${c.gray('v' + version)}`;
  const provider = `${c.gray('Provider:')} ${c.hex(blue).bold('GitHub Models')}`;
  const session = `${c.gray('Session:')} ${c.hex(green).bold('active')} ${c.gray(`(${sessDir})`)}`;
  const modelLine = `${c.gray('Model:')} ${c.hex(blue)(model)}`;
  const hints = safeUnicode
    ? hintSegments.map((segment) => formatHintSegment(segment, c.gray)).join('  ')
    : plainHints;

  return [
    '',
    `  ${title}`,
    `  ${provider}  ${c.gray('│')}  ${modelLine}`,
    `  ${session}`,
    `  ${c.gray('─'.repeat(68))}`,
    `  ${hints}`,
    '',
  ].join('\n');
}

function formatHintSegment(segment: string, colorize: (text: string) => string): string {
  const firstSpace = segment.indexOf(' ');
  if (firstSpace === -1) return colorize(segment);
  const key = segment.slice(0, firstSpace);
  const suffix = segment.slice(firstSpace);
  return `${colorize(key)}${suffix}`;
}
