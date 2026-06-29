import { spawn } from 'node:child_process';
import path from 'node:path';
import { select, input } from '@inquirer/prompts';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { toolMemory } from './memory.js';
import { loadPolicy, shellCommandAllowed } from './policy.js';
import { assertSandbox } from './sandbox.js';
import { checkCommandSafety } from './safety.js';

export interface ShellResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Propose a shell command with an interactive action menu, then run it.
 */
export async function proposeAndRun(
  cmd: string,
  opts: { explain?: string; cwd?: string } = {},
): Promise<ShellResult> {
  const cwd = path.resolve(opts.cwd || config.cwd);
  const policy = loadPolicy(config.cwd);
  if (!shellCommandAllowed(cmd, policy)) {
    process.stdout.write(theme.err('  policy denied\n'));
    return { ran: false, exitCode: null, stdout: '', stderr: 'policy denied' };
  }
  try {
    assertSandbox(cwd, config.cwd);
  } catch (e: any) {
    const message = e?.message || String(e);
    process.stdout.write(theme.err(`  ${message}\n`));
    return { ran: false, exitCode: null, stdout: '', stderr: message };
  }

  if (!config.quiet && !config.jsonOutput) {
    process.stdout.write('\n');
    process.stdout.write(theme.badge('SHELL') + '\n');
    if (opts.explain) process.stdout.write(theme.dim('  ' + opts.explain) + '\n');
    process.stdout.write('\n');
    process.stdout.write(theme.dim('  ┌─────────────────────────────────────────\n'));
    process.stdout.write(theme.dim('  │ ') + theme.hl('$ ') + syntaxHighlightShell(cmd) + '\n');
    process.stdout.write(theme.dim('  └─────────────────────────────────────────\n'));
    process.stdout.write(theme.dim(`  cwd: ${cwd}\n`));
    process.stdout.write('\n');
  }

  const safety = checkCommandSafety(cmd);
  const remembered = toolMemory.isShellRemembered(cmd);
  let activeCmd = cmd;
  let ok = false;

  if (config.autoApprove && safety.level !== 'critical') {
    ok = true;
  } else if (safety.level === 'critical') {
    ok = await approveCritical(safety.reason).catch(() => false);
  } else if (remembered && safety.level === 'safe') {
    ok = true;
  } else {
    const result = await actionMenu(safety.reason, safety.level === 'warn', activeCmd);
    ok = result.ok;
    if (result.editedCmd) activeCmd = result.editedCmd;
  }

  if (!ok) {
    if (!config.jsonOutput) process.stdout.write(theme.warn('  skipped.\n'));
    return { ran: false, exitCode: null, stdout: '', stderr: '' };
  }

  if (!config.autoApprove && !remembered) {
    const remember = await select({
      message: 'Remember this command approval for the session?',
      choices: [
        { name: 'No', value: false },
        { name: 'Yes — skip confirmation next time', value: true },
      ],
    }).catch(() => false);
    if (remember) toolMemory.rememberShell(activeCmd);
  }
  return runCaptured(activeCmd, cwd);
}

/** Interactive 3-choice action menu replacing plain Y/n. */
async function actionMenu(
  reason: string,
  warned: boolean,
  cmd: string,
): Promise<{ ok: boolean; editedCmd?: string }> {
  if (warned && !config.quiet && !config.jsonOutput) {
    process.stdout.write(theme.warn(`  ⚠  Warning: ${reason}\n\n`));
  }

  const action = await select({
    message: 'What would you like to do?',
    choices: [
      { name: '  Run this command', value: 'run' },
      { name: '  Edit command before running', value: 'edit' },
      { name: '  Cancel and return to REPL', value: 'cancel' },
    ],
  }).catch(() => 'cancel');

  if (action === 'run') return { ok: true };
  if (action === 'cancel') return { ok: false };

  // Edit flow
  const edited = await input({
    message: 'Edit command:',
    default: cmd,
  }).catch(() => cmd);

  if (!edited.trim()) return { ok: false };
  process.stdout.write('\n');
  process.stdout.write(theme.dim('  ┌─────────────────────────────────────────\n'));
  process.stdout.write(theme.dim('  │ ') + theme.hl('$ ') + syntaxHighlightShell(edited) + '\n');
  process.stdout.write(theme.dim('  └─────────────────────────────────────────\n\n'));

  const confirm = await select({
    message: 'Run the edited command?',
    choices: [
      { name: '  Run', value: true },
      { name: '  Cancel', value: false },
    ],
  }).catch(() => false);

  return { ok: Boolean(confirm), editedCmd: edited };
}

async function approveCritical(reason: string): Promise<boolean> {
  if (config.autoApprove) {
    process.stdout.write(theme.err(`  blocked critical command: ${reason}\n`));
    return false;
  }
  process.stdout.write(theme.err('\n  !!! CRITICAL COMMAND WARNING !!!\n'));
  process.stdout.write(theme.err(`  Reason: ${reason}\n\n`));
  const answer = await input({
    message: 'Type "yes" to proceed with this critical command:',
    default: '',
  }).catch(() => '');
  return answer.trim() === 'yes';
}

// ─── Shell syntax highlighter ─────────────────────────────────────────────
// bright-green command, yellow flags, white strings, purple vars, green paths.
export function syntaxHighlightShell(line: string): string {
  // When colors are off, return raw
  if (process.env.NO_COLOR || config.theme === 'none') return line;

  const parts: string[] = [];
  let rest = line;
  let isCmd = true;

  while (rest.length > 0) {
    // Whitespace
    const ws = rest.match(/^(\s+)/);
    if (ws) {
      parts.push(ws[1]);
      rest = rest.slice(ws[1].length);
      continue;
    }

    // Pipeline / logical operators — next word is a command
    const pipe = rest.match(/^(\|{1,2}|&&|\|\||;;|;)/);
    if (pipe) {
      parts.push('\x1b[90m' + pipe[1] + '\x1b[0m');
      rest = rest.slice(pipe[1].length);
      isCmd = true;
      continue;
    }

    // Quoted strings (single or double)
    const str = rest.match(/^(["'])((?:\\.|(?!\1).)*)(\1)/s);
    if (str) {
      parts.push('\x1b[97m' + str[0] + '\x1b[0m'); // bright white
      rest = rest.slice(str[0].length);
      isCmd = false;
      continue;
    }

    // Variables $VAR or ${VAR}
    const varT = rest.match(/^(\$\{[^}]+\}|\$\w+)/);
    if (varT) {
      parts.push('\x1b[35m' + varT[1] + '\x1b[0m'); // magenta
      rest = rest.slice(varT[1].length);
      isCmd = false;
      continue;
    }

    // Flags --flag / -f
    const flag = rest.match(/^(--?[\w][\w-]*)/);
    if (flag) {
      parts.push('\x1b[33m' + flag[1] + '\x1b[0m'); // yellow
      rest = rest.slice(flag[1].length);
      isCmd = false;
      continue;
    }

    // Word token (command, path, or plain arg)
    const word = rest.match(/^([^\s|;&'"$\\]+)/);
    if (word) {
      const w = word[1];
      if (isCmd) {
        parts.push('\x1b[92m\x1b[1m' + w + '\x1b[0m'); // bright green bold
        isCmd = false;
      } else if (/^[./~]/.test(w) || /\//.test(w)) {
        parts.push('\x1b[32m' + w + '\x1b[0m'); // green (path)
      } else {
        parts.push(w);
      }
      rest = rest.slice(w.length);
      continue;
    }

    parts.push(rest[0]);
    rest = rest.slice(1);
  }
  return parts.join('');
}

function runCaptured(cmd: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : 'bash';
    const args = isWin ? ['-NoProfile', '-Command', cmd] : ['-lc', cmd];

    const child = spawn(shell, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (!config.jsonOutput) process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (!config.jsonOutput) process.stderr.write(s);
    });
    child.on('close', (code) => {
      resolve({ ran: true, exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      stderr += String(err);
      resolve({ ran: true, exitCode: -1, stdout, stderr });
    });
  });
}

export interface ShellResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
