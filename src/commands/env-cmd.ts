import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { theme } from '../ui/theme.js';

export interface EnvInfo {
  key: string;
  value: string;
  source: string;
}

const SECRET_MIN_LENGTH = 8;

export function maskSecret(value: string): string {
  if (value.length < SECRET_MIN_LENGTH) return '***';
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

export function envCommand(args: string[]): string {
  if (args[0] === '--check') {
    return checkVar(args[1]);
  }

  if (args[0] === '--full') {
    return formatEnvInfo('iCopilot environment', getFullEnvInfo());
  }

  return formatEnvInfo('Environment context', getDefaultEnvInfo());
}

function checkVar(name: string | undefined): string {
  if (!name) return theme.warn('usage: /env --check <VAR>\n');

  const value = process.env[name];
  const source = value === undefined ? 'unset' : 'env';
  const rendered = value === undefined ? theme.dim('(not set)') : renderValue(name, value);
  return formatEnvInfo('Environment check', [{ key: name, value: rendered, source }]);
}

function getDefaultEnvInfo(): EnvInfo[] {
  const shellValue = process.env.SHELL || process.env.ComSpec;
  const homeValue = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const info: EnvInfo[] = [
    envEntry('GITHUB_TOKEN', process.env.GITHUB_TOKEN, 'env'),
    envEntry('ICOPILOT_MODEL', process.env.ICOPILOT_MODEL, 'env'),
    envEntry('ICOPILOT_THEME', process.env.ICOPILOT_THEME, 'env'),
    envEntry('ICOPILOT_SANDBOX', process.env.ICOPILOT_SANDBOX, 'env'),
    envEntry('ICOPILOT_DEBUG', process.env.ICOPILOT_DEBUG, 'env'),
    envEntry('SHELL / ComSpec', shellValue, shellValue ? 'env' : 'unset'),
    runtimeEntry('NODE_VERSION', process.version),
    runtimeEntry('CWD', process.cwd()),
    runtimeEntry('HOME', homeValue),
  ];

  const branch = gitBranch();
  if (branch) info.push({ key: 'Git branch', value: branch, source: 'git' });

  return info;
}

function getFullEnvInfo(): EnvInfo[] {
  const matches = Object.entries(process.env)
    .filter(([key]) => key.startsWith('ICOPILOT_'))
    .sort(([left], [right]) => left.localeCompare(right));

  if (matches.length === 0) {
    return [{ key: 'ICOPILOT_*', value: theme.dim('(none set)'), source: 'env' }];
  }

  return matches.map(([key, value]) => envEntry(key, value, 'env'));
}

function envEntry(key: string, value: string | undefined, source: string): EnvInfo {
  if (value === undefined) {
    return { key, value: theme.dim('(not set)'), source: 'unset' };
  }

  return { key, value: renderValue(key, value), source };
}

function runtimeEntry(key: string, value: string): EnvInfo {
  return { key, value, source: 'runtime' };
}

function renderValue(key: string, value: string): string {
  return isSecretKey(key) ? maskSecret(value) : value;
}

function isSecretKey(key: string): boolean {
  return /(TOKEN|SECRET|PASSWORD|KEY)$/i.test(key);
}

function gitBranch(): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return branch || null;
  } catch {
    return null;
  }
}

function formatEnvInfo(title: string, items: EnvInfo[]): string {
  const lines = items.map(
    ({ key, value, source }) => `  ${theme.hl(key)} ${theme.dim(`[${source}]`)} ${value}`,
  );
  return `${theme.brand(title)}\n${lines.join('\n')}\n`;
}
