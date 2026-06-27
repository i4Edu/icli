import { theme } from '../ui/theme.js';

export interface SafetyCheck {
  dangerous: boolean;
  level: 'safe' | 'warn' | 'critical';
  reason: string;
}

const SAFE_CHECK: SafetyCheck = {
  dangerous: false,
  level: 'safe',
  reason: '',
};

const FORK_BOMB_PATTERN = /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;
const ROOT_DELETE_PATTERN =
  /\brm\s+-rf\b[^\n\r;|&]*?(?:^|\s)(?:\/(?:\s|$)|~(?:\s|$)|["']\/["']|["']~["'])/i;
const RECURSIVE_DELETE_PATTERN = /\brm\s+-rf\b/i;
const SQL_DESTRUCTIVE_PATTERN = /\b(?:drop\s+table|drop\s+database|truncate(?:\s+table)?)\b/i;
const FORCE_PUSH_PATTERN = /\bgit\s+push\b[^\n\r;|&]*(?:\s--force(?:-with-lease)?\b|\s-f\b)/i;
const CHMOD_WORLD_WRITABLE_PATTERN = /\bchmod\b[^\n\r;|&]*\b777\b/i;
const DEV_NULL_REDIRECT_PATTERN = /(?:^|\s)(?:\d*>)\s*\/dev\/null\b/;
const IMPORTANT_COMMAND_PATTERN =
  /\b(?:rm|git|chmod|chown|dd|mkfs(?:\.\w+)?|curl|wget|docker|kubectl|npm|pnpm|yarn|node|psql|mysql|sqlite3|systemctl|service)\b/i;
const PIPE_TO_SHELL_PATTERN = /\b(?:curl|wget)\b[^\n\r;|&]*\|\s*(?:sh|bash|zsh|ksh|fish)\b/i;
const MKFS_PATTERN = /\bmkfs(?:\.\w+)?\b/i;
const DD_TO_DEVICE_PATTERN = /\bdd\b[^\n\r;|&]*\bif=[^\s]+[^\n\r;|&]*\bof=\/dev\/\S+/i;

export function checkCommandSafety(command: string): SafetyCheck {
  const normalized = command.trim();
  if (!normalized) return SAFE_CHECK;

  if (FORK_BOMB_PATTERN.test(normalized)) {
    return critical('fork bomb can exhaust system resources');
  }

  if (ROOT_DELETE_PATTERN.test(normalized)) {
    return critical('recursive delete of root/home');
  }

  if (SQL_DESTRUCTIVE_PATTERN.test(normalized)) {
    return critical('destructive SQL command detected');
  }

  if (MKFS_PATTERN.test(normalized) || DD_TO_DEVICE_PATTERN.test(normalized)) {
    return critical('disk formatting or raw device overwrite detected');
  }

  if (RECURSIVE_DELETE_PATTERN.test(normalized)) {
    return warn('recursive delete may remove many files');
  }

  if (FORCE_PUSH_PATTERN.test(normalized)) {
    return warn('force push may overwrite remote history');
  }

  if (CHMOD_WORLD_WRITABLE_PATTERN.test(normalized)) {
    return warn('world-writable permissions');
  }

  if (DEV_NULL_REDIRECT_PATTERN.test(normalized) && IMPORTANT_COMMAND_PATTERN.test(normalized)) {
    return warn('output redirection may hide failures from an important command');
  }

  if (PIPE_TO_SHELL_PATTERN.test(normalized)) {
    return warn('piping remote scripts to a shell can execute untrusted code');
  }

  return SAFE_CHECK;
}

export function formatSafetyWarning(check: SafetyCheck): string {
  if (!check.dangerous || check.level === 'safe') return '';
  if (check.level === 'critical') {
    return theme.err(`Critical: ${check.reason}`);
  }
  return theme.warn(`Warning: ${check.reason}`);
}

function warn(reason: string): SafetyCheck {
  return { dangerous: true, level: 'warn', reason };
}

function critical(reason: string): SafetyCheck {
  return { dangerous: true, level: 'critical', reason };
}
