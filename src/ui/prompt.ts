import readline from 'node:readline';
import { theme } from './theme.js';

export interface ReplPrompt {
  read(prompt: string): Promise<string>;
  close(): void;
}

/** Minimal readline-based prompt (history-enabled). */
export function createPrompt(): ReplPrompt {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    // Future DX: path completion can be added here without changing callers.
    historySize: 500,
  });
  return {
    read(prompt: string): Promise<string> {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer));
      });
    },
    close() {
      rl.close();
    },
  };
}

export function prefix(mode: 'ask' | 'plan'): string {
  const safeUnicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);
  const tag = safeUnicode
    ? mode === 'plan'
      ? theme.badge('PLAN')
      : theme.badge('ASK')
    : `[${mode === 'plan' ? 'PLAN' : 'ASK'}]`;
  return `${tag} ${theme.user(safeUnicode ? '›' : '>')} `;
}
