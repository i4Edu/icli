import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Policy {
  allowShell?: string[];
  denyShell?: string[];
  allowWrite?: string[];
  denyWrite?: string[];
  sandbox?: boolean;
}

export function loadPolicy(cwd: string): Policy {
  const globalPolicy = readPolicy(path.join(os.homedir(), '.icopilot', 'policy.json'));
  const localPolicy = readPolicy(path.join(cwd, '.icopilot', 'policy.json'));
  return mergePolicy(globalPolicy, localPolicy);
}

export function shellCommandAllowed(cmd: string, policy: Policy): boolean {
  const full = cmd.trim();
  const first = full.split(/\s+/)[0] || '';
  if (!hasPolicy(policy.denyShell) && !hasPolicy(policy.allowShell)) return true;
  if (matchesAny(policy.denyShell, full) || matchesAny(policy.denyShell, first)) return false;
  if (hasPolicy(policy.allowShell)) {
    return matchesAny(policy.allowShell, full) || matchesAny(policy.allowShell, first);
  }
  return true;
}

export function writePathAllowed(absPath: string, policy: Policy, cwd: string): boolean {
  const rel = normalize(path.relative(cwd, absPath));
  const normalizedAbs = normalize(path.resolve(absPath));
  if (!hasPolicy(policy.denyWrite) && !hasPolicy(policy.allowWrite)) return true;
  if (matchesAny(policy.denyWrite, rel) || matchesAny(policy.denyWrite, normalizedAbs))
    return false;
  if (hasPolicy(policy.allowWrite)) {
    return matchesAny(policy.allowWrite, rel) || matchesAny(policy.allowWrite, normalizedAbs);
  }
  return true;
}

export function matches(pattern: string, str: string): boolean {
  const source = normalize(pattern);
  const target = normalize(str);
  if (source === target || target.startsWith(source.endsWith('/') ? source : `${source}/`)) {
    return true;
  }
  const re = new RegExp(`^${globToRegex(source)}$`, process.platform === 'win32' ? 'i' : '');
  return re.test(target);
}

function readPolicy(file: string): Policy {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Policy;
  } catch {
    return {};
  }
}

function mergePolicy(base: Policy, override: Policy): Policy {
  return {
    allowShell: mergeArray(base.allowShell, override.allowShell),
    denyShell: mergeArray(base.denyShell, override.denyShell),
    allowWrite: mergeArray(base.allowWrite, override.allowWrite),
    denyWrite: mergeArray(base.denyWrite, override.denyWrite),
    sandbox: override.sandbox ?? base.sandbox,
  };
}

function mergeArray(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...(a || []), ...(b || [])];
  return merged.length ? merged : undefined;
}

function hasPolicy(patterns?: string[]): boolean {
  return Boolean(patterns?.length);
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  return Boolean(patterns?.some((pattern) => matches(pattern, value)));
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegex(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    const next = pattern[i + 1];
    if (c === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
