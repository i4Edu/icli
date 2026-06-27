import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface Alias {
  name: string;
  expansion: string;
  createdAt: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/i;
const ALIASES_ENV = 'ICOPILOT_ALIASES_PATH';

export function aliasesPath(): string {
  return process.env[ALIASES_ENV] || path.join(os.homedir(), '.icopilot', 'aliases.json');
}

export function loadAliases(): Alias[] {
  const file = aliasesPath();
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAlias).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function saveAlias(name: string, expansion: string): Alias {
  const trimmedName = name.trim();
  if (!NAME_RE.test(trimmedName)) {
    throw new Error('alias name must match /^[a-z0-9][a-z0-9_-]{0,32}$/i');
  }

  const trimmedExpansion = expansion.trim();
  if (!trimmedExpansion) {
    throw new Error('alias expansion is required');
  }

  const aliases = loadAliases();
  const existing = aliases.find(
    (alias) => alias.name.localeCompare(trimmedName, undefined, { sensitivity: 'accent' }) === 0,
  );
  const alias: Alias = {
    name: trimmedName,
    expansion: trimmedExpansion,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  const next = aliases.filter(
    (entry) => entry.name.localeCompare(trimmedName, undefined, { sensitivity: 'accent' }) !== 0,
  );
  next.push(alias);
  writeAliases(next);
  return alias;
}

export function deleteAlias(name: string): boolean {
  const trimmedName = name.trim();
  const aliases = loadAliases();
  const next = aliases.filter(
    (alias) => alias.name.localeCompare(trimmedName, undefined, { sensitivity: 'accent' }) !== 0,
  );
  if (next.length === aliases.length) return false;

  writeAliases(next);
  return true;
}

export function resolveAlias(input: string, aliases: Alias[]): string | null {
  const trimmed = input.trimStart();
  if (!trimmed) return null;

  const ordered = [...aliases].sort(
    (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name),
  );
  for (const alias of ordered) {
    if (!trimmed.toLowerCase().startsWith(alias.name.toLowerCase())) continue;
    const remainder = trimmed.slice(alias.name.length);
    if (remainder.length > 0 && !/^\s/.test(remainder)) continue;
    const suffix = remainder.trimStart();
    return suffix ? `${alias.expansion} ${suffix}` : alias.expansion;
  }

  return null;
}

export function aliasCommand(args: string[]): string {
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || 'list').toLowerCase();

  try {
    switch (subcommand) {
      case 'list':
        return listCommand();
      case 'set':
        return setCommand(rest);
      case 'remove':
      case 'delete':
      case 'rm':
        return removeCommand(rest);
      default:
        return usage();
    }
  } catch (error) {
    return theme.err(`alias: ${(error as Error).message}\n`);
  }
}

function listCommand(): string {
  const aliases = loadAliases();
  if (aliases.length === 0) return theme.dim('No aliases saved.\n');

  const lines = aliases.map(
    (alias) => `  ${theme.hl(alias.name)}  ${theme.dim('→')} ${alias.expansion}`,
  );
  return `${theme.brand('Aliases')}\n${lines.join('\n')}\n`;
}

function setCommand(args: string[]): string {
  const [name, ...expansionParts] = args;
  const expansion = expansionParts.join(' ').trim();
  if (!name || !expansion) return theme.warn('usage: /alias set <name> <expansion...>\n');

  const alias = saveAlias(name, expansion);
  return theme.ok(`✔ saved alias ${alias.name} ${theme.dim('→')} ${alias.expansion}\n`);
}

function removeCommand(args: string[]): string {
  const [name] = args;
  if (!name) return theme.warn('usage: /alias remove <name>\n');

  return deleteAlias(name)
    ? theme.ok(`✔ deleted alias ${name}\n`)
    : theme.warn(`alias not found: ${name}\n`);
}

function usage(): string {
  return theme.warn('usage: /alias [list|set|remove]\n');
}

function writeAliases(aliases: Alias[]): void {
  const file = aliasesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = [...aliases].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function isAlias(value: unknown): value is Alias {
  if (!value || typeof value !== 'object') return false;
  const alias = value as Record<string, unknown>;
  return (
    typeof alias.name === 'string' &&
    typeof alias.expansion === 'string' &&
    typeof alias.createdAt === 'string' &&
    NAME_RE.test(alias.name) &&
    alias.expansion.trim().length > 0
  );
}
