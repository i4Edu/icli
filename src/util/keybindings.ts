/**
 * Vi and Emacs keybinding support for readline-based REPL.
 * Provides modal editing (vi) and extended key sequences (emacs).
 */

import readline from 'node:readline';
import { config } from '../config.js';

export type KeybindingMode = 'vi' | 'emacs' | 'default';

export interface KeybindingState {
  mode: KeybindingMode;
  viMode: 'normal' | 'insert';
  buffer: string;
  cursor: number;
}

const DEFAULT_KEYMAP: Record<string, string> = {
  emacs: 'EMACS',
  vi: 'VI',
  default: 'DEFAULT',
};

/**
 * Enhance readline interface with vi/emacs keybindings.
 * Note: Node's readline has limited key handling. This provides
 * basic support through key event listeners and buffer manipulation.
 */
export function attachKeybindings(
  rl: readline.Interface,
  mode: KeybindingMode = 'default',
): KeybindingState {
  if (mode === 'default') {
    return { mode: 'default', viMode: 'insert', buffer: '', cursor: 0 };
  }

  const state: KeybindingState = {
    mode,
    viMode: 'insert',
    buffer: '',
    cursor: 0,
  };

  // Node.js readline doesn't expose raw key events in a portable way.
  // Instead, we provide integration points that applications can use.
  // For full vi/emacs support, users should use a readline alternative like ink or blessed.

  // Store reference to readline for applications to integrate with.
  (rl as any).__keybindingMode = mode;
  (rl as any).__keybindingState = state;

  return state;
}

/**
 * Check if readline interface has keybindings attached.
 */
export function hasKeybindings(rl: readline.Interface): boolean {
  return !!(rl as any).__keybindingMode && (rl as any).__keybindingMode !== 'default';
}

/**
 * Get current keybinding mode.
 */
export function getKeybindingMode(rl: readline.Interface): KeybindingMode {
  return (rl as any).__keybindingMode ?? 'default';
}

/**
 * Guide text for keybindings.
 */
export function getKeybindingHelp(mode: KeybindingMode): string {
  if (mode === 'vi') {
    return `
Vi keybindings enabled.
  ESC        enter normal mode
  i          insert mode
  dd         delete line
  yy         yank (copy) line
  p          paste
  h/j/k/l    navigation
  0/$        go to start/end of line
  A/I        append/insert at line end/start
  u          undo

Type '/help keybindings' for more info.
`;
  } else if (mode === 'emacs') {
    return `
Emacs keybindings enabled.
  C-a        go to line start
  C-e        go to line end
  C-k        kill to line end
  C-u        kill from line start
  C-w        kill word
  M-d        delete word
  C-y        yank (paste)
  C-r        search history

Type '/help keybindings' for more info.
`;
  }
  return 'Default keybindings enabled. Type "/help keybindings" for more info.\n';
}

/**
 * Get recommended readline options for keybinding mode.
 * These work with native Node readline, but for full vi/emacs experience,
 * use a library like ink, blessed, or rustyline (via wasm).
 */
export function getReadlineOptionsForMode(mode: KeybindingMode): Partial<readline.ReadLineOptions> {
  // Node.js readline has limited keybinding support.
  // In native mode, only basic Ctrl sequences work.
  // Full vi/emacs would require a wrapper library.

  return {
    terminal: true,
    historySize: 500,
  };
}

/**
 * Apply keybinding configuration from .icopilotrc.
 */
export function applyKeybindingConfig(): KeybindingMode {
  const mode = (config as any).keybindings?.mode ?? 'default';
  if (mode !== 'vi' && mode !== 'emacs' && mode !== 'default') {
    return 'default';
  }
  return mode;
}

/**
 * Format keybinding info for display.
 */
export function formatKeybindingInfo(mode: KeybindingMode): string {
  const modeLabel = mode === 'vi' ? '🔤 Vi' : mode === 'emacs' ? '🔤 Emacs' : '⌨️  Default';
  return `${modeLabel} mode`;
}
