import { loadStats, resetStats, statsPath } from '../stats/store.js';
import { theme } from '../ui/theme.js';

export function statsCommand(sub = 'show'): string {
  const cmd = sub.trim().toLowerCase() || 'show';

  if (cmd === 'reset') {
    resetStats();
    return `${theme.ok('✔ usage stats reset')}\n`;
  }

  if (cmd === 'path') {
    return `${theme.dim(statsPath())}\n`;
  }

  const s = loadStats();
  return [
    theme.brand('Usage stats'),
    `  first seen:  ${theme.hl(s.firstSeen)}`,
    `  last update: ${theme.hl(s.lastUpdate)}`,
    `  sessions:    ${theme.hl(String(s.sessions))}`,
    `  tokens in:   ${theme.hl(String(s.tokensIn))}`,
    `  tokens out:  ${theme.hl(String(s.tokensOut))}`,
    '',
    theme.brand('Top tool calls'),
    formatTop(s.toolCalls),
    '',
    theme.brand('Top commands'),
    formatTop(s.commands),
    '',
  ].join('\n');
}

function formatTop(counters: Record<string, number>): string {
  const top = Object.entries(counters)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  if (top.length === 0) return `  ${theme.dim('none')}`;
  return top.map(([name, count]) => `  ${theme.hl(String(count)).padStart(5)}  ${name}`).join('\n');
}
