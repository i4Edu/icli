import path from 'node:path';

export function isSandboxed(): boolean {
  return process.env.ICOPILOT_SANDBOX === '1';
}

export function pathInSandbox(absPath: string, cwdRoot: string): boolean {
  const resolvedPath = path.resolve(absPath);
  const resolvedRoot = path.resolve(cwdRoot);
  const rel = path.relative(resolvedRoot, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertSandbox(absPath: string, cwdRoot: string): void {
  if (isSandboxed() && !pathInSandbox(absPath, cwdRoot)) {
    throw new Error(`sandbox violation: ${path.resolve(absPath)} outside ${path.resolve(cwdRoot)}`);
  }
}
