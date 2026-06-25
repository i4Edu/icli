import { spawn } from 'node:child_process';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { toolMemory } from './memory.js';
import { loadPolicy, shellCommandAllowed } from './policy.js';
import { assertSandbox } from './sandbox.js';

export interface ShellResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Propose a shell command, require confirmation, then run it.
 * Output is streamed to the terminal AND captured for return.
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

  process.stdout.write('\n' + theme.badge('SHELL') + '\n');
  if (opts.explain) process.stdout.write(theme.dim(opts.explain) + '\n');
  process.stdout.write(theme.hl('  $ ') + cmd + '\n');
  process.stdout.write(theme.dim(`  cwd: ${cwd}\n`));

  const remembered = toolMemory.isShellRemembered(cmd);
  const ok =
    remembered ||
    (await confirm({
      message: 'Run this command?',
      default: false,
    }).catch(() => false));

  if (!ok) {
    process.stdout.write(theme.warn('  skipped.\n'));
    return { ran: false, exitCode: null, stdout: '', stderr: '' };
  }

  if (!remembered) {
    const remember = await confirm({
      message: 'Remember this command for the session?',
      default: false,
    }).catch(() => false);
    if (remember) toolMemory.rememberShell(cmd);
  }
  return runCaptured(cmd, cwd);
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
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
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
