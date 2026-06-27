import { theme } from '../ui/theme.js';

export interface WatchConfig {
  pattern: string;
  command: string;
  debounceMs: number;
}

export interface WatchState {
  active: boolean;
  pattern: string;
  command: string;
  triggerCount: number;
}

const DEFAULT_DEBOUNCE_MS = 500;

const WATCH_USAGE = [
  theme.brand('Watch command'),
  `  ${theme.hl('/watch set <pattern> <command>')}  ${theme.dim('configure a file watch')}`,
  `  ${theme.hl('/watch stop')}                   ${theme.dim('stop the active watch')}`,
  `  ${theme.hl('/watch status')}                 ${theme.dim('show the current watch state')}`,
].join('\n');

let currentConfig: WatchConfig | null = null;
let currentState: WatchState | null = null;

export function parseWatchArgs(args: string[]): WatchConfig | { error: string } {
  const [pattern, ...commandParts] = args;

  if (!pattern || commandParts.length === 0) {
    return { error: 'usage: /watch set <pattern> <command>' };
  }

  const command = commandParts.join(' ').trim();
  if (!command) {
    return { error: 'usage: /watch set <pattern> <command>' };
  }

  if (!isValidGlob(pattern)) {
    return { error: `invalid glob pattern: ${pattern}` };
  }

  return {
    pattern,
    command,
    debounceMs: DEFAULT_DEBOUNCE_MS,
  };
}

export function formatWatchStatus(state: WatchState | null): string {
  if (!state) {
    return `${theme.warn('No watch configured.')}\n`;
  }

  return [
    theme.brand('Watch status'),
    `  active:        ${theme.hl(state.active ? 'yes' : 'no')}`,
    `  pattern:       ${theme.hl(state.pattern)}`,
    `  command:       ${theme.hl(state.command)}`,
    `  trigger count: ${theme.hl(String(state.triggerCount))}`,
    '',
  ].join('\n');
}

export function watchCommand(args: string[]): string {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    return `${WATCH_USAGE}\n\n${formatConfiguredStatus()}`;
  }

  switch (subcommand.toLowerCase()) {
    case 'set': {
      const parsed = parseWatchArgs(rest);
      if ('error' in parsed) {
        return `${theme.warn(parsed.error)}\n${theme.dim('Example: /watch set src/**/*.ts npm test')}\n`;
      }

      currentConfig = parsed;
      currentState = {
        active: true,
        pattern: parsed.pattern,
        command: parsed.command,
        triggerCount: 0,
      };

      return `${theme.ok('✔ watch configured')}\n${formatConfiguredStatus()}`;
    }
    case 'stop':
      if (!currentState) {
        return `${theme.warn('No watch configured.')}\n`;
      }

      currentState = { ...currentState, active: false };
      return `${theme.ok('✔ watch stopped')}\n${formatConfiguredStatus()}`;
    case 'status':
      return formatConfiguredStatus();
    default:
      return `${theme.warn(`unknown watch subcommand: ${subcommand}`)}\n${WATCH_USAGE}\n`;
  }
}

function formatConfiguredStatus(): string {
  const status = formatWatchStatus(currentState).trimEnd();
  if (!currentConfig) return `${status}\n`;

  return `${status}\n  debounce:      ${theme.hl(`${currentConfig.debounceMs}ms`)}\n`;
}

function isValidGlob(pattern: string): boolean {
  if (!pattern.trim()) return false;
  if (/[\0\r\n]/.test(pattern)) return false;
  return hasBalancedDelimiters(pattern);
}

function hasBalancedDelimiters(pattern: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = {
    '[': ']',
    '{': '}',
    '(': ')',
  };
  const closing = new Set(Object.values(pairs));

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '\\') {
      index += 1;
      continue;
    }

    if (char in pairs) {
      stack.push(pairs[char]);
      continue;
    }

    if (closing.has(char) && stack.pop() !== char) {
      return false;
    }
  }

  return stack.length === 0;
}
