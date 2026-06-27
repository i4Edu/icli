import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface BuildError {
  file?: string;
  line?: number;
  message: string;
  code?: string;
  severity: 'error' | 'warning';
}

export interface HealAttempt {
  error: BuildError;
  diagnosis: string;
  fix: string;
  applied: boolean;
}

export interface BuildResult {
  success: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  errors: BuildError[];
}

export interface HealResult {
  success: boolean;
  command: string;
  attempts: HealAttempt[];
  build: BuildResult;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, cwd: string) => Promise<ExecResult>;

interface TypeScriptContext {
  importPath?: string;
  suggestedImportPath?: string;
  missingName?: string;
}

interface ImportContext {
  importPath?: string;
}

interface EslintContext {
  rule?: string;
}

type ErrorContext =
  | { kind: 'typescript'; details: TypeScriptContext }
  | { kind: 'eslint'; details: EslintContext }
  | { kind: 'import'; details: ImportContext }
  | { kind: 'generic'; details: Record<string, never> };

const TYPESCRIPT_PATTERNS = [
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning)\s+(?<code>TS\d+):\s*(?<message>.+)$/imu,
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*-\s*(?<severity>error|warning)\s+(?<code>TS\d+):\s*(?<message>.+)$/imu,
];

const ESLINT_PATTERNS = [
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning)\s+(?<message>.+?)(?:\s+\((?<code>[^)]+)\))?$/imu,
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning)\s+(?<message>.+?)(?:\s+\((?<code>[^)]+)\))?$/imu,
];

const RUNTIME_IMPORT_PATTERNS = [
  /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module ['"](?<missing>.+?)['"] imported from (?<file>.+)$/imu,
  /Cannot find module ['"](?<missing>.+?)['"] imported from (?<file>.+)$/imu,
];

const NODE_GLOBAL_NAMES = new Set(['process', 'buffer', '__dirname', '__filename', 'global']);

export class SelfHealingBuilder {
  private readonly rootDir: string;
  private readonly runner: CommandRunner;
  private readonly contexts = new Map<string, ErrorContext>();

  constructor(rootDir = process.cwd(), options?: { runner?: CommandRunner }) {
    this.rootDir = path.resolve(rootDir);
    this.runner = options?.runner ?? runShellCommand;
  }

  async build(command = this.detectBuildCommand(this.rootDir)): Promise<BuildResult> {
    this.contexts.clear();
    const result = await this.runner(command, this.rootDir);
    const errors = parseBuildErrors(`${result.stdout}\n${result.stderr}`, this.rootDir);
    for (const parsed of errors) {
      this.contexts.set(errorKey(parsed.error), parsed.context);
    }

    return {
      success: result.exitCode === 0,
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      errors: errors.map((entry) => entry.error),
    };
  }

  diagnose(errors: BuildError[]): HealAttempt[] {
    return errors.map((error) => {
      const context = this.contexts.get(errorKey(error)) ?? inferContext(error);
      return {
        error,
        diagnosis: describeDiagnosis(error, context),
        fix: describeFix(error, context),
        applied: false,
      };
    });
  }

  async applyFix(attempt: HealAttempt): Promise<boolean> {
    const context = this.contexts.get(errorKey(attempt.error)) ?? inferContext(attempt.error);
    const applied = await this.applyFixForError(attempt.error, context);
    attempt.applied = applied;
    return applied;
  }

  async healAndRetry(maxAttempts = 3): Promise<HealResult> {
    const command = this.detectBuildCommand(this.rootDir);
    const attempts: HealAttempt[] = [];
    let build = await this.build(command);

    for (let iteration = 0; iteration < maxAttempts && !build.success; iteration += 1) {
      const diagnoses = this.diagnose(build.errors);
      const nextAttempt = diagnoses.find((attempt) => isFixable(attempt.fix));
      if (!nextAttempt) break;

      const applied = await this.applyFix(nextAttempt);
      attempts.push(nextAttempt);
      if (!applied) break;

      build = await this.build(command);
    }

    return {
      success: build.success,
      command,
      attempts,
      build,
    };
  }

  detectBuildCommand(rootDir: string): string {
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = readJsonFile<{ scripts?: Record<string, unknown> }>(packageJsonPath);
    const scripts = packageJson?.scripts ?? {};

    if (typeof scripts.typecheck === 'string') return 'npm run typecheck';
    if (typeof scripts.build === 'string') return 'npm run build';
    if (typeof scripts.lint === 'string') return 'npm run lint';
    if (fs.existsSync(path.join(rootDir, 'tsconfig.json'))) return 'npx tsc --noEmit';
    if (hasEslintConfig(rootDir)) return 'npx eslint .';
    return 'npm run build';
  }

  private async applyFixForError(error: BuildError, context: ErrorContext): Promise<boolean> {
    switch (context.kind) {
      case 'typescript':
        if (context.details.suggestedImportPath) {
          const currentSpecifier =
            context.details.importPath === context.details.suggestedImportPath
              ? this.readImportSpecifier(error.file, error.line)
              : context.details.importPath;
          return this.rewriteImportSpecifier(
            error.file,
            error.line,
            currentSpecifier,
            context.details.suggestedImportPath,
          );
        }
        if (context.details.importPath) {
          const nextSpecifier = this.resolveImportCandidate(error.file, context.details.importPath);
          if (nextSpecifier) {
            return this.rewriteImportSpecifier(
              error.file,
              error.line,
              context.details.importPath,
              nextSpecifier,
            );
          }
        }
        if (
          error.code === 'TS2580' &&
          context.details.missingName &&
          NODE_GLOBAL_NAMES.has(context.details.missingName.toLowerCase())
        ) {
          return this.ensureNodeTypes();
        }
        return false;
      case 'import':
        if (!context.details.importPath) return false;
        return this.rewriteImportSpecifier(
          error.file,
          error.line,
          context.details.importPath,
          this.resolveImportCandidate(error.file, context.details.importPath) ??
            context.details.importPath,
        );
      case 'eslint':
        return this.applyEslintLineFix(error, context.details.rule ?? error.code);
      default:
        return false;
    }
  }

  private resolveImportCandidate(
    filePath: string | undefined,
    specifier: string,
  ): string | undefined {
    if (!filePath || !specifier.startsWith('.')) return undefined;
    const absoluteBase = path.resolve(path.dirname(filePath), specifier);
    const candidates = [
      { file: `${absoluteBase}.ts`, replacement: `${specifier}.js` },
      { file: `${absoluteBase}.tsx`, replacement: `${specifier}.js` },
      { file: path.join(absoluteBase, 'index.ts'), replacement: `${specifier}/index.js` },
      { file: path.join(absoluteBase, 'index.tsx'), replacement: `${specifier}/index.js` },
    ];

    return candidates.find((candidate) => fs.existsSync(candidate.file))?.replacement;
  }

  private rewriteImportSpecifier(
    filePath: string | undefined,
    lineNumber: number | undefined,
    previousSpecifier: string | undefined,
    nextSpecifier: string | undefined,
  ): boolean {
    if (!filePath || !previousSpecifier || !nextSpecifier || previousSpecifier === nextSpecifier) {
      return false;
    }
    if (!fs.existsSync(filePath)) return false;

    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/u);
    const index = typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber - 1 : -1;
    if (index < 0 || index >= lines.length) return false;

    const line = lines[index];
    if (!line.includes(previousSpecifier)) return false;
    lines[index] = line.replace(previousSpecifier, nextSpecifier);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return true;
  }

  private readImportSpecifier(
    filePath: string | undefined,
    lineNumber: number | undefined,
  ): string | undefined {
    if (!filePath || typeof lineNumber !== 'number' || !fs.existsSync(filePath)) return undefined;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
    const line = lines[lineNumber - 1];
    if (!line) return undefined;
    const match = /from\s+['"](?<value>[^'"]+)['"]|import\s+['"](?<value2>[^'"]+)['"]/u.exec(line);
    return match?.groups?.value ?? match?.groups?.value2;
  }

  private ensureNodeTypes(): boolean {
    const tsconfigPath = path.join(this.rootDir, 'tsconfig.json');
    const tsconfig = readJsonFile<{ compilerOptions?: { types?: string[] } }>(tsconfigPath);
    if (!tsconfig) return false;

    const currentTypes = new Set(tsconfig.compilerOptions?.types ?? []);
    if (currentTypes.has('node')) return false;

    currentTypes.add('node');
    tsconfig.compilerOptions = {
      ...(tsconfig.compilerOptions ?? {}),
      types: [...currentTypes],
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf8');
    return true;
  }

  private applyEslintLineFix(error: BuildError, rule?: string): boolean {
    if (!error.file || typeof error.line !== 'number' || !fs.existsSync(error.file)) return false;
    const source = fs.readFileSync(error.file, 'utf8');
    const lines = source.split(/\r?\n/u);
    const index = error.line - 1;
    if (index < 0 || index >= lines.length) return false;

    const original = lines[index];
    let updated = original;
    const normalizedRule = (rule ?? '').trim();

    if (normalizedRule === 'semi' || /missing semicolon/i.test(error.message)) {
      updated = original.trimEnd().endsWith(';') ? original : `${original.trimEnd()};`;
    } else if (normalizedRule === 'no-trailing-spaces' || /trailing spaces?/i.test(error.message)) {
      updated = original.replace(/\s+$/u, '');
    } else {
      return false;
    }

    if (updated === original) return false;
    lines[index] = updated;
    fs.writeFileSync(error.file, lines.join('\n'), 'utf8');
    return true;
  }
}

function parseBuildErrors(
  output: string,
  rootDir: string,
): Array<{ error: BuildError; context: ErrorContext }> {
  const parsed: Array<{ error: BuildError; context: ErrorContext }> = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/u);

  for (const line of lines) {
    const entry =
      parseTypeScriptError(line, rootDir) ??
      parseEslintError(line, rootDir) ??
      parseImportError(line, rootDir);
    if (!entry) continue;

    const key = errorKey(entry.error);
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(entry);
  }

  return parsed;
}

function parseTypeScriptError(
  line: string,
  rootDir: string,
): { error: BuildError; context: ErrorContext } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  for (const pattern of TYPESCRIPT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match?.groups?.message) continue;

    const rawFile = match.groups.file;
    const file = rawFile ? resolveBuildPath(rootDir, rawFile.trim()) : undefined;
    const message = match.groups.message.trim();
    const importPath = extractQuotedValue(message);
    const suggestedImportPath = extractDidYouMean(message);
    const missingName = extractMissingName(message);
    return {
      error: {
        file,
        line: toNumber(match.groups.line),
        code: match.groups.code?.trim(),
        severity: normalizeSeverity(match.groups.severity),
        message,
      },
      context: {
        kind: 'typescript',
        details: { importPath, suggestedImportPath, missingName },
      },
    };
  }

  return null;
}

function parseEslintError(
  line: string,
  rootDir: string,
): { error: BuildError; context: ErrorContext } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  for (const pattern of ESLINT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match?.groups?.message) continue;
    const rule = match.groups.code?.trim() || extractTrailingRule(match.groups.message);
    return {
      error: {
        file: resolveBuildPath(rootDir, match.groups.file.trim()),
        line: toNumber(match.groups.line),
        code: rule,
        severity: normalizeSeverity(match.groups.severity),
        message: stripTrailingRule(match.groups.message),
      },
      context: {
        kind: 'eslint',
        details: { rule },
      },
    };
  }

  return null;
}

function parseImportError(
  line: string,
  rootDir: string,
): { error: BuildError; context: ErrorContext } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  for (const pattern of RUNTIME_IMPORT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match?.groups?.file || !match.groups.missing) continue;
    const importerFile = resolveBuildPath(rootDir, match.groups.file.trim());
    const missingPath = match.groups.missing.trim();
    const importPath = importerFile
      ? deriveRelativeSpecifier(importerFile, missingPath)
      : undefined;
    return {
      error: {
        file: importerFile,
        message: trimmed,
        severity: 'error',
        code: 'ERR_MODULE_NOT_FOUND',
      },
      context: {
        kind: 'import',
        details: { importPath },
      },
    };
  }

  return null;
}

function inferContext(error: BuildError): ErrorContext {
  if (error.code?.startsWith('TS')) {
    return {
      kind: 'typescript',
      details: {
        importPath: extractQuotedValue(error.message),
        suggestedImportPath: extractDidYouMean(error.message),
        missingName: extractMissingName(error.message),
      },
    };
  }
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    return { kind: 'import', details: {} };
  }
  if (error.code) {
    return { kind: 'eslint', details: { rule: error.code } };
  }
  return { kind: 'generic', details: {} };
}

function describeDiagnosis(error: BuildError, context: ErrorContext): string {
  switch (context.kind) {
    case 'typescript':
      if (context.details.importPath) {
        return `TypeScript cannot resolve import ${context.details.importPath}.`;
      }
      if (context.details.missingName) {
        return `TypeScript cannot find the global ${context.details.missingName}.`;
      }
      return `TypeScript reported ${error.code ?? 'a compiler error'}.`;
    case 'eslint':
      return `ESLint flagged rule ${context.details.rule ?? error.code ?? 'unknown'}.`;
    case 'import':
      return `A runtime import path cannot be resolved from ${error.file ?? 'the current file'}.`;
    default:
      return error.message;
  }
}

function describeFix(error: BuildError, context: ErrorContext): string {
  switch (context.kind) {
    case 'typescript':
      if (context.details.suggestedImportPath) {
        return `Update the import to ${context.details.suggestedImportPath}.`;
      }
      if (context.details.importPath) {
        return 'Resolve the relative import to an existing .js entrypoint.';
      }
      if (
        error.code === 'TS2580' &&
        context.details.missingName &&
        NODE_GLOBAL_NAMES.has(context.details.missingName.toLowerCase())
      ) {
        return 'Add Node.js typings to tsconfig.json.';
      }
      return 'No safe automatic TypeScript fix available.';
    case 'eslint':
      if (
        context.details.rule === 'semi' ||
        /missing semicolon/i.test(error.message) ||
        context.details.rule === 'no-trailing-spaces'
      ) {
        return 'Apply a single-line ESLint-safe edit.';
      }
      return 'No safe automatic ESLint fix available.';
    case 'import':
      if (context.details.importPath) {
        return 'Rewrite the import to a resolvable relative .js path.';
      }
      return 'No safe automatic import fix available.';
    default:
      return 'No safe automatic fix available.';
  }
}

function isFixable(fix: string): boolean {
  return !/^No safe automatic/i.test(fix);
}

function errorKey(error: BuildError): string {
  return JSON.stringify({
    file: error.file,
    line: error.line,
    message: error.message,
    code: error.code,
    severity: error.severity,
  });
}

async function runShellCommand(command: string, cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : 'bash';
    const args = isWin ? ['-NoProfile', '-Command', command] : ['-lc', command];
    const child = spawn(shell, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      resolve({
        exitCode: typeof exitCode === 'number' ? exitCode : -1,
        stdout,
        stderr,
      });
    });
    child.on('error', (error) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
  });
}

function resolveBuildPath(rootDir: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.resolve(rootDir, filePath);
}

function normalizeSeverity(value: string | undefined): 'error' | 'warning' {
  return value?.toLowerCase() === 'warning' ? 'warning' : 'error';
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractQuotedValue(message: string): string | undefined {
  const match = /['"](?<value>\.[^'"]+)['"]/u.exec(message);
  return match?.groups?.value;
}

function extractDidYouMean(message: string): string | undefined {
  const match = /Did you mean ['"](?<value>[^'"]+)['"]\?/u.exec(message);
  return match?.groups?.value;
}

function extractMissingName(message: string): string | undefined {
  const match = /Cannot find name ['"](?<value>[^'"]+)['"]/u.exec(message);
  return match?.groups?.value;
}

function extractTrailingRule(message: string): string | undefined {
  const match = /\((?<rule>[^)]+)\)\s*$/u.exec(message.trim());
  return match?.groups?.rule;
}

function stripTrailingRule(message: string): string {
  return message.replace(/\s+\([^)]+\)\s*$/u, '').trim();
}

function deriveRelativeSpecifier(importerFile: string, missingPath: string): string | undefined {
  const importerDir = path.dirname(importerFile);
  const relative = path.relative(importerDir, missingPath).replace(/\\/gu, '/');
  if (!relative) return undefined;
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function hasEslintConfig(rootDir: string): boolean {
  try {
    return fs.readdirSync(rootDir).some((entry) => entry.startsWith('.eslintrc'));
  } catch {
    return false;
  }
}
