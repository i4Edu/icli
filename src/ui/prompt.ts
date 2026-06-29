import readline from 'node:readline';
import { theme } from './theme.js';
import { attachKeybindings, applyKeybindingConfig, type KeybindingMode } from '../util/keybindings.js';

export interface ReplPrompt {
  read(prompt: string): Promise<string>;
  close(): void;
  getKeybindingMode?(): KeybindingMode;
}

/** Minimal readline-based prompt (history-enabled, with optional keybindings). */
export function createPrompt(keybindingMode?: KeybindingMode): ReplPrompt {
  const mode = keybindingMode ?? applyKeybindingConfig();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    // Future DX: path completion can be added here without changing callers.
    historySize: 500,
  });

  // Attach keybindings if configured
  if (mode !== 'default') {
    attachKeybindings(rl, mode);
  }

  return {
    read(prompt: string): Promise<string> {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer));
      });
    },
    close() {
      rl.close();
    },
    getKeybindingMode() {
      return mode;
    },
  };
}

export function prefix(mode: 'ask' | 'plan'): string {
  const safeUnicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);
  const label = mode === 'plan' ? 'Plan' : 'Copilot';
  const tag = safeUnicode ? theme.badge(label) : `[${label}]`;
  return `${tag} ${theme.user(safeUnicode ? '›' : '>')} `;
}
