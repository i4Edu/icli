import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface RefactorPayload {
  kind: string;
  description: string;
  prompt: string;
}

function usage(): string {
  return [
    theme.brand('Refactor command'),
    '  /refactor rename <old> <new> [path]    build a rename-symbol refactor prompt',
    '  /refactor extract <path> <lines>       build an extract-function refactor prompt',
    '  /refactor inline <path> <symbol>       build an inline-symbol refactor prompt',
    '',
  ].join('\n');
}

function renderPayload(payload: RefactorPayload): string {
  return `${theme.hl(payload.description)}\n${payload.prompt}\n`;
}

function renderError(message: string): string {
  return `${theme.err(message)}\n`;
}

function resolveExistingPath(cwd: string, target: string): string | undefined {
  const resolvedPath = path.resolve(cwd, target);
  return fs.existsSync(resolvedPath) ? resolvedPath : undefined;
}

function buildRenamePayload(args: string[], cwd: string): string {
  const [oldSymbol, newSymbol, targetPath] = args;
  if (!oldSymbol || !newSymbol) {
    return renderError('usage: /refactor rename <old> <new> [path]');
  }

  let scope = `across the workspace rooted at ${cwd}`;
  if (targetPath) {
    const resolvedPath = resolveExistingPath(cwd, targetPath);
    if (!resolvedPath) {
      return renderError(`target file not found: ${path.resolve(cwd, targetPath)}`);
    }
    scope = `starting from ${resolvedPath} and any related files`;
  }

  const payload: RefactorPayload = {
    kind: 'rename',
    description: `Refactor intent: rename "${oldSymbol}" to "${newSymbol}"`,
    prompt:
      `Rename the symbol "${oldSymbol}" to "${newSymbol}" ${scope}. ` +
      'Update all references, imports, exports, and type usages consistently. ' +
      'Avoid unrelated edits and preserve behavior.',
  };

  return renderPayload(payload);
}

function buildExtractPayload(args: string[], cwd: string): string {
  const [targetPath, lines] = args;
  if (!targetPath || !lines) {
    return renderError('usage: /refactor extract <path> <lines>');
  }

  const resolvedPath = resolveExistingPath(cwd, targetPath);
  if (!resolvedPath) {
    return renderError(`target file not found: ${path.resolve(cwd, targetPath)}`);
  }

  const payload: RefactorPayload = {
    kind: 'extract',
    description: `Refactor intent: extract a function from ${path.basename(resolvedPath)}:${lines}`,
    prompt:
      `Extract a well-named function from lines ${lines} in ${resolvedPath}. ` +
      'Preserve the current behavior, keep dependencies explicit, and update the original call site to use the new function. ' +
      'Prefer a minimal, readable refactor.',
  };

  return renderPayload(payload);
}

function buildInlinePayload(args: string[], cwd: string): string {
  const [targetPath, symbol] = args;
  if (!targetPath || !symbol) {
    return renderError('usage: /refactor inline <path> <symbol>');
  }

  const resolvedPath = resolveExistingPath(cwd, targetPath);
  if (!resolvedPath) {
    return renderError(`target file not found: ${path.resolve(cwd, targetPath)}`);
  }

  const payload: RefactorPayload = {
    kind: 'inline',
    description: `Refactor intent: inline "${symbol}" in ${path.basename(resolvedPath)}`,
    prompt:
      `Inline the symbol "${symbol}" in ${resolvedPath}. ` +
      'Replace its usages with the underlying expression or implementation where appropriate, remove the obsolete declaration if safe, ' +
      'and keep the file behavior unchanged.',
  };

  return renderPayload(payload);
}

export function refactorCommand(args: string[], cwd: string): string {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    return usage();
  }

  switch (subcommand.toLowerCase()) {
    case 'rename':
      return buildRenamePayload(rest, cwd);
    case 'extract':
      return buildExtractPayload(rest, cwd);
    case 'inline':
      return buildInlinePayload(rest, cwd);
    default:
      return `${theme.warn(`unknown refactor subcommand: ${subcommand}`)}\n${usage()}`;
  }
}
