import { spawn } from 'node:child_process';
import path from 'node:path';
import { detectLinters } from '../commands/lint-cmd.js';
import { detectTestFrameworks } from '../commands/test-cmd.js';
import { config } from '../config.js';

export interface AutoCheckConfig {
  autoLint: boolean;
  autoTest: boolean;
  autoFix: boolean;
  lintCmd?: string;
  testCmd?: string;
}

export interface AutoCheckResult {
  passed: boolean;
  output: string;
  fixable: boolean;
}

export type AutoCheckKind = 'lint' | 'test';

export const AUTO_FIX_MAX_RETRIES = 3;

type CommandResult = {
  exitCode: number;
  output: string;
};

export function getAutoCheckConfig(): AutoCheckConfig {
  return {
    autoLint: config.autoLint,
    autoTest: config.autoTest,
    autoFix: config.autoFix,
    lintCmd: config.lintCmd.trim() || undefined,
    testCmd: config.testCmd.trim() || undefined,
  };
}

export function detectAutoLintCommand(cwd = config.cwd): string | undefined {
  const configured = config.lintCmd.trim();
  if (configured) return configured;
  const linters = detectLinters(cwd);
  const preferred =
    linters.find((entry) => entry.name === 'eslint' || entry.name === 'eslint-config') ??
    linters.find((entry) => entry.name === 'npm-lint') ??
    linters[0];
  return preferred?.command;
}

export function detectAutoTestCommand(cwd = config.cwd): string | undefined {
  const configured = config.testCmd.trim();
  if (configured) return configured;
  const frameworks = detectTestFrameworks(cwd);
  const preferred =
    frameworks.find((entry) => entry.name === 'npm-test') ??
    frameworks.find((entry) => entry.name === 'vitest') ??
    frameworks.find((entry) => entry.name === 'jest') ??
    frameworks[0];
  return preferred?.command;
}

export async function runAutoLint(changedFiles: string[]): Promise<AutoCheckResult> {
  const normalizedFiles = normalizeFiles(changedFiles);
  if (!normalizedFiles.length) {
    return { passed: true, output: 'No changed files to lint.', fixable: false };
  }
  const lintableFiles = normalizedFiles.filter((file) =>
    /\.(?:[cm]?[jt]sx?|py|go|java|cs|php|rb)$/iu.test(file),
  );
  if (!lintableFiles.length) {
    return { passed: true, output: 'No lintable changed files detected.', fixable: false };
  }

  const command = buildLintCommand(lintableFiles, config.cwd, getAutoCheckConfig());
  if (!command) {
    return { passed: false, output: 'No configured linter detected for auto-lint.', fixable: false };
  }

  const result = await executeShellCommand(command, config.cwd);
  return toAutoCheckResult(result, { missingCommand: false });
}

export async function runAutoTest(): Promise<AutoCheckResult> {
  const command = buildTestCommand(config.cwd, getAutoCheckConfig());
  if (!command) {
    return { passed: false, output: 'No configured test runner detected for auto-test.', fixable: false };
  }

  const result = await executeShellCommand(command, config.cwd);
  return toAutoCheckResult(result, { missingCommand: false });
}

export function extractChangedFilesFromToolResult(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
): string[] {
  const parsed = tryParseJson(output);
  switch (toolName) {
    case 'write_file':
      return parsed?.wrote && typeof args.path === 'string' ? [args.path] : [];
    case 'write_files':
      return parsed?.wrote && Array.isArray(args.items)
        ? args.items
            .map((item) => (item && typeof item === 'object' ? String((item as { path?: string }).path ?? '') : ''))
            .filter(Boolean)
        : [];
    case 'edit_file':
      return parsed?.ok && typeof args.path === 'string' ? [args.path] : [];
    case 'multi_edit':
      return Array.isArray(parsed?.applied)
        ? parsed.applied.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [];
    case 'apply_patch':
      return Array.isArray(parsed?.applied)
        ? parsed.applied
            .map((entry: { path?: unknown }) => (typeof entry?.path === 'string' ? entry.path : ''))
            .filter(Boolean)
        : [];
    default:
      return [];
  }
}

export function extractAutoLintResult(output: string): AutoCheckResult | undefined {
  const parsed = tryParseJson(output);
  const candidate = parsed?.autoLint;
  if (!candidate || typeof candidate !== 'object') return undefined;
  if (typeof candidate.passed !== 'boolean' || typeof candidate.output !== 'string') return undefined;
  return {
    passed: candidate.passed,
    output: candidate.output,
    fixable: Boolean(candidate.fixable),
  };
}

export function formatAutoCheckResult(
  kind: AutoCheckKind,
  result: AutoCheckResult,
  changedFiles: string[] = [],
): string {
  const header = kind === 'lint' ? 'AUTO LINT' : 'AUTO TEST';
  const label = changedFiles.length ? ` ${changedFiles.join(', ')}` : '';
  const summary = result.passed ? 'passed' : 'failed';
  const detail = result.output.trim();
  return [`${header}${label}: ${summary}`, detail].filter(Boolean).join('\n');
}

export function buildAutoFixPrompt(
  kind: AutoCheckKind,
  result: AutoCheckResult,
  attempt: number,
  changedFiles: string[] = [],
): string {
  const scope = changedFiles.length ? `Files: ${changedFiles.join(', ')}\n` : '';
  return [
    `Automatic ${kind} failed after your recent edits.`,
    `Retry ${attempt}/${AUTO_FIX_MAX_RETRIES}.`,
    scope.trimEnd(),
    'Fix the reported problem using the available file-editing tools, then stop so the check can re-run.',
    '',
    result.output.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildLintCommand(
  lintableFiles: string[],
  cwd: string,
  overrides: AutoCheckConfig,
): string | undefined {
  const configured = overrides.lintCmd?.trim();
  if (configured) return injectFiles(configured, lintableFiles);

  const linters = detectLinters(cwd);
  if (!linters.length) return undefined;

  const explicitEslint = linters.some(
    (entry) => entry.name === 'eslint' || entry.name === 'eslint-config',
  );
  if (explicitEslint) {
    return ['npx', 'eslint', ...lintableFiles].map(quoteArg).join(' ');
  }

  const preferred = linters.find((entry) => entry.name === 'npm-lint') ?? linters[0];
  return injectFiles(preferred.command, lintableFiles);
}

function buildTestCommand(cwd: string, overrides: AutoCheckConfig): string | undefined {
  const configured = overrides.testCmd?.trim();
  if (configured) return configured;

  const frameworks = detectTestFrameworks(cwd);
  if (!frameworks.length) return undefined;

  const preferred =
    frameworks.find((entry) => entry.name === 'npm-test') ??
    frameworks.find((entry) => entry.name === 'vitest') ??
    frameworks.find((entry) => entry.name === 'jest') ??
    frameworks[0];

  return preferred?.command;
}

async function executeShellCommand(command: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? process.env.ComSpec || 'cmd.exe' : 'bash';
    const args = isWin ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, output });
    });
    child.on('error', (error) => {
      resolve({ exitCode: -1, output: `${output}${error.message}` });
    });
  });
}

function toAutoCheckResult(
  result: CommandResult,
  options: { missingCommand: boolean },
): AutoCheckResult {
  const output = result.output.trim();
  const commandMissing =
    options.missingCommand ||
    /(?:is not recognized as|not found|No configured .* detected|could not find)/iu.test(output);
  return {
    passed: result.exitCode === 0,
    output: output || (result.exitCode === 0 ? 'Check passed.' : 'Check failed with no output.'),
    fixable: result.exitCode !== 0 && !commandMissing,
  };
}

function injectFiles(command: string, files: string[]): string {
  if (!files.length) return command;
  const fileArgs = files.map(quoteArg).join(' ');
  if (command.includes('{files}')) {
    return command.replace(/\{files\}/gu, fileArgs);
  }
  if (/^(?:npm|pnpm|yarn)\s+/iu.test(command)) {
    return `${command} -- ${fileArgs}`;
  }
  return `${command} ${fileArgs}`;
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => path.normalize(file)).filter(Boolean))];
}

function quoteArg(value: string): string {
  return `"${value.replace(/(["\\$`])/gu, '\\$1')}"`;
}

function tryParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
