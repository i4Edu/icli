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

// ─── ASCII logo (figlet "iCopilot") ──────────────────────────────────────────
// Rendered in cyan/light-blue to match GitHub Copilot's design language.
const ASCII_LOGO_LINES = [
  ' ___               _ _       _   ',
  '|_ _|___ ___  _ __(_) | ___ | |_ ',
  ' | |/ __/ _ \\| \'_ \\ | |/ _ \\| __|',
  ' | | (_| (_) | |_) | | | (_) | |_ ',
  '|___\\___\\___/| .__/|_|_|\\___/ \\__|',
  '             |_|                  ',
];

export function banner(version: string, model: string, sessionDir?: string): string {
  if (!colorEnabled()) {
    return [
      '',
      'iCopilot  v' + version + '  model: ' + model,
      '/help for commands · @file to add context · Tab to autocomplete',
      '',
    ].join('\n');
  }

  const { c, name } = palette();
  const green = name === 'light' ? '#166534' : '#3FB950';
  const blue = '#58A6FF';

  // Render ASCII logo in cyan/light-blue
  const logo = ASCII_LOGO_LINES.map((row) => `  ${c.hex(blue).bold(row)}`).join('\n');

  const sessDir = sessionDir ?? '~/.icopilot/sessions/';
  const divider = `  ${c.gray('─'.repeat(50))}`;

  const diag1 =
    `  ${c.hex(green)('●')} ` +
    `${c.gray('Provider:')} ${c.hex(blue).bold('GitHub Models')} ` +
    `${c.gray('(default: ' + model + ')')}`;

  const diag2 =
    `  ${c.hex(green)('●')} ` +
    `${c.gray('Session: ')} ${c.hex(blue)('Active')} ` +
    `${c.gray('(' + sessDir + ')')}`;

  const hints = safeUnicode
    ? `${c.gray('/help')} for commands  ${c.gray('@file')} to add context  ${c.gray('Tab')} to autocomplete`
    : `/help for commands  @file to add context  Tab to autocomplete`;

  return [
    '',
    logo,
    '',
    diag1,
    diag2,
    divider,
    '',
    `  ${c.gray('v' + version)}  ${c.gray('·')}  ${c.hex(blue)(model)}`,
    `  ${hints}`,
    '',
  ].join('\n');
}
