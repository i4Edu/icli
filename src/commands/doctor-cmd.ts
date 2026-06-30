import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export function runDiagnostics(): DiagnosticCheck[] {
  const home = os.homedir();
  const rcPath = path.join(home, '.icopilotrc.json');
  const icopilotDir = path.join(home, '.icopilot');

  return [
    {
      name: 'GITHUB_TOKEN',
      status: process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 'ok' : 'fail',
      message: process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 'set' : 'not set',
    },
    {
      name: '~/.icopilotrc.json',
      status: fs.existsSync(rcPath) ? 'ok' : 'warn',
      message: fs.existsSync(rcPath) ? 'found' : 'using defaults',
    },
    nodeVersionCheck(),
    gitCheck(),
    {
      name: '~/.icopilot/',
      status: fs.existsSync(icopilotDir) ? 'ok' : 'warn',
      message: fs.existsSync(icopilotDir) ? 'found' : 'will be created on first use',
    },
    sessionDirectoryCheck(home),
    mcpConfigCheck(home),
  ];
}

export function formatDiagnostics(checks: DiagnosticCheck[]): string {
  const lines = checks.map((check) => {
    const icon = statusIcon(check.status);
    const label = statusLabel(check.status);
    return `  ${icon} ${theme.hl(check.name)} ${theme.dim(`(${label})`)} ${check.message}`;
  });

  return `${theme.brand('iCopilot doctor')}\n${lines.join('\n')}\n`;
}

function nodeVersionCheck(): DiagnosticCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  const ok = Number.isFinite(major) && major >= 18;
  return {
    name: 'Node.js >= 18',
    status: ok ? 'ok' : 'fail',
    message: `detected ${process.versions.node}`,
  };
}

function gitCheck(): DiagnosticCheck {
  const available = hasGitOnPath();
  return {
    name: 'git',
    status: available ? 'ok' : 'warn',
    message: available ? 'available on PATH' : 'not found on PATH',
  };
}

function sessionDirectoryCheck(home: string): DiagnosticCheck {
  const sessionDir =
    process.env.ICOPILOT_SESSION_DIR || path.join(home, '.terminal-copilot', 'sessions');
  const writable = isWritableDirectory(sessionDir);
  return {
    name: 'session directory',
    status: writable ? 'ok' : 'fail',
    message: writable ? sessionDir : `not writable: ${sessionDir}`,
  };
}

function mcpConfigCheck(home: string): DiagnosticCheck {
  const hasUserConfig = fs.existsSync(path.join(home, '.icopilot', 'mcp.json'));
  const hasProjectConfig = fs.existsSync(path.join(process.cwd(), '.mcp.json'));
  return {
    name: 'MCP config',
    status: hasUserConfig || hasProjectConfig ? 'ok' : 'warn',
    message:
      hasProjectConfig || hasUserConfig
        ? hasProjectConfig
          ? '.mcp.json found'
          : '~/.icopilot/mcp.json found'
        : 'no MCP servers configured',
  };
}

function statusIcon(status: DiagnosticCheck['status']): string {
  switch (status) {
    case 'ok':
      return theme.ok('✔');
    case 'warn':
      return theme.warn('⚠');
    case 'fail':
      return theme.err('✖');
  }
}

function statusLabel(status: DiagnosticCheck['status']): string {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'warn':
      return 'warn';
    case 'fail':
      return 'fail';
  }
}

function hasGitOnPath(): boolean {
  const candidates = new Set<string>();
  const pathValue = process.env.PATH || '';
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const executableNames =
    process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git.bat', 'git'] : ['git'];

  for (const dir of pathEntries) {
    for (const executableName of executableNames) {
      candidates.add(path.join(dir, executableName));
    }
  }

  if (process.platform === 'win32') {
    candidates.add(path.join('C:\\Program Files\\Git\\cmd', 'git.exe'));
    candidates.add(path.join('C:\\Program Files\\Git\\bin', 'git.exe'));
    candidates.add(path.join('C:\\Program Files (x86)\\Git\\cmd', 'git.exe'));
    candidates.add(path.join('C:\\Program Files (x86)\\Git\\bin', 'git.exe'));
  } else {
    candidates.add('/usr/bin/git');
    candidates.add('/usr/local/bin/git');
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
    } catch {
      // Ignore unreadable paths and keep checking.
    }
  }

  return false;
}

function isWritableDirectory(target: string): boolean {
  const existing = nearestExistingPath(target);
  if (!existing) return false;

  try {
    const stats = fs.statSync(existing);
    const probe = stats.isDirectory() ? existing : path.dirname(existing);
    fs.accessSync(probe, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function nearestExistingPath(target: string): string | null {
  let current = path.resolve(target);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return current;
}
