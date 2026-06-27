import { spawn, type ChildProcess } from 'node:child_process';

export interface ParsedError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  code?: string;
  raw: string;
}

type ErrorCallback = (error: ParsedError) => void;

const TYPESCRIPT_PATTERNS = [
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning)\s+(?<code>TS\d+):\s*(?<message>.+)$/i,
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*-\s*(?<severity>error|warning)\s+(?<code>TS\d+):\s*(?<message>.+)$/i,
  /^(?<severity>error|warning)\s+(?<code>TS\d+):\s*(?<message>.+)$/i,
];

const ESLINT_PATTERNS = [
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning)\s+(?<message>.+?)(?:\s+\((?<code>[^)]+)\))?$/i,
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning)\s+(?<message>.+?)(?:\s+\((?<code>[^)]+)\))?$/i,
];

const GENERIC_PATTERNS = [
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*[:\-]\s*(?<severity>error|warning)\s*:?\s*(?<message>.+)$/i,
  /^(?<severity>error|warning)\s*[:\-]\s*(?<message>.+)$/i,
  /^(?<severity>warning|error)\b.*?:\s*(?<message>.+)$/i,
  /^(?<severity>error|warning)\b(?<message>.+)$/i,
];

export class ErrorWatcher {
  private proc: ChildProcess | null = null;
  private errors: ParsedError[] = [];
  private callbacks = new Set<ErrorCallback>();
  private seen = new Set<string>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private command: string | null = null;
  private running = false;

  start(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error('command is required');
    }

    this.stop();
    this.clear();
    this.command = trimmed;

    const { shell, args } = getShellInvocation(trimmed);
    const child = spawn(shell, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc = child;
    this.running = true;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => this.consumeChunk('stdout', chunk));
    child.stderr?.on('data', (chunk: string) => this.consumeChunk('stderr', chunk));

    child.on('error', (error) => {
      this.record({
        severity: 'error',
        message: `Failed to start watcher: ${error.message}`,
        raw: error.message,
      });
      this.running = false;
      this.proc = null;
    });

    child.on('close', () => {
      this.flushBuffer('stdout');
      this.flushBuffer('stderr');
      this.running = false;
      this.proc = null;
    });
  }

  stop(): void {
    const child = this.proc;
    this.proc = null;
    this.running = false;
    this.command = null;

    if (!child) return;
    child.kill('SIGTERM');
  }

  onError(callback: (error: ParsedError) => void): void {
    this.callbacks.add(callback);
  }

  getErrors(): ParsedError[] {
    return this.errors.map((error) => ({ ...error }));
  }

  clear(): void {
    this.errors = [];
    this.seen.clear();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }

  isRunning(): boolean {
    return this.running;
  }

  getCommand(): string | null {
    return this.command;
  }

  private consumeChunk(stream: 'stdout' | 'stderr', chunk: string): void {
    const next = `${stream === 'stdout' ? this.stdoutBuffer : this.stderrBuffer}${chunk}`;
    const lines = next.split(/\r?\n/);
    const remainder = lines.pop() ?? '';

    if (stream === 'stdout') {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }

    for (const line of lines) {
      this.processLine(line);
    }
  }

  private flushBuffer(stream: 'stdout' | 'stderr'): void {
    const buffer = stream === 'stdout' ? this.stdoutBuffer : this.stderrBuffer;
    if (buffer.trim()) {
      this.processLine(buffer);
    }

    if (stream === 'stdout') {
      this.stdoutBuffer = '';
    } else {
      this.stderrBuffer = '';
    }
  }

  private processLine(line: string): void {
    const parsed = parseErrorLine(line);
    if (parsed) {
      this.record(parsed);
    }
  }

  private record(error: ParsedError): void {
    const signature = JSON.stringify({
      file: error.file,
      line: error.line,
      column: error.column,
      severity: error.severity,
      code: error.code,
      message: error.message,
      raw: error.raw,
    });

    if (this.seen.has(signature)) return;

    this.seen.add(signature);
    this.errors.push(error);

    for (const callback of this.callbacks) {
      callback({ ...error });
    }
  }
}

export function suggestFix(error: ParsedError): string {
  const location =
    error.file && error.line !== undefined
      ? `${error.file}:${error.line}${error.column !== undefined ? `:${error.column}` : ''}`
      : error.file || 'unknown location';

  const hint = inferHint(error);
  const lines = [
    `Investigate and fix this ${error.severity}:`,
    `Location: ${location}`,
    error.code ? `Code: ${error.code}` : undefined,
    `Message: ${error.message}`,
    hint ? `Hint: ${hint}` : undefined,
    'Propose the smallest safe code change, explain why it fixes the issue, and avoid unrelated edits.',
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

function parseErrorLine(rawLine: string): ParsedError | null {
  const raw = rawLine.trim();
  if (!raw) return null;

  const parsed =
    matchPattern(raw, TYPESCRIPT_PATTERNS, normalizeTypeScriptError) ??
    matchPattern(raw, ESLINT_PATTERNS, normalizeLintError) ??
    matchPattern(raw, GENERIC_PATTERNS, normalizeGenericError);

  return parsed ? { ...parsed, raw } : null;
}

function matchPattern(
  raw: string,
  patterns: RegExp[],
  normalize: (match: RegExpExecArray) => Omit<ParsedError, 'raw'> | null,
): Omit<ParsedError, 'raw'> | null {
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (!match) continue;
    return normalize(match);
  }
  return null;
}

function normalizeTypeScriptError(match: RegExpExecArray): Omit<ParsedError, 'raw'> | null {
  const groups = match.groups;
  if (!groups?.message || !groups.severity) return null;

  return {
    file: groups.file,
    line: toNumber(groups.line),
    column: toNumber(groups.column),
    severity: normalizeSeverity(groups.severity),
    code: groups.code,
    message: groups.message.trim(),
  };
}

function normalizeLintError(match: RegExpExecArray): Omit<ParsedError, 'raw'> | null {
  const groups = match.groups;
  if (!groups?.message || !groups.severity) return null;

  const lintCode = groups.code?.trim();
  return {
    file: groups.file,
    line: toNumber(groups.line),
    column: toNumber(groups.column),
    severity: normalizeSeverity(groups.severity),
    code: lintCode || extractTrailingRule(groups.message),
    message: stripTrailingRule(groups.message),
  };
}

function normalizeGenericError(match: RegExpExecArray): Omit<ParsedError, 'raw'> | null {
  const groups = match.groups;
  if (!groups?.message || !groups.severity) return null;

  return {
    file: groups.file,
    line: toNumber(groups.line),
    column: toNumber(groups.column),
    severity: normalizeSeverity(groups.severity),
    message: groups.message.trim(),
  };
}

function normalizeSeverity(value: string): 'error' | 'warning' {
  return value.toLowerCase() === 'warning' ? 'warning' : 'error';
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripTrailingRule(message: string): string {
  return message.replace(/\s+\(([^)]+)\)\s*$/, '').trim();
}

function extractTrailingRule(message: string): string | undefined {
  const explicitRule = /\s+\(([^)]+)\)\s*$/.exec(message)?.[1];
  if (explicitRule) return explicitRule;

  const tokens = message.trim().split(/\s+/);
  const candidate = tokens[tokens.length - 1];
  return candidate && /^(?:@?[\w-]+\/)?[\w-]+$/.test(candidate) ? candidate : undefined;
}

function inferHint(error: ParsedError): string | undefined {
  const code = error.code?.toUpperCase();
  const message = error.message.toLowerCase();

  if (code === 'TS2304' || message.includes('cannot find name')) {
    return 'Check for a missing import, a misspelled symbol, or a variable that is out of scope.';
  }

  if (code === 'TS2322' || code === 'TS2345' || message.includes('not assignable')) {
    return 'Compare the expected and actual types, then narrow, convert, or update the declaration at the source.';
  }

  if (code?.startsWith('TS')) {
    return 'Inspect the referenced TypeScript types, imports, and nearby declarations before changing behavior.';
  }

  if (error.code) {
    return `Review the rule or diagnostic "${error.code}" and make the smallest change that satisfies it.`;
  }

  if (error.severity === 'warning') {
    return 'Prefer a low-risk cleanup that addresses the warning without changing runtime behavior.';
  }

  return 'Trace the failing file and surrounding code path, then patch the root cause instead of silencing the symptom.';
}

function getShellInvocation(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      shell: 'powershell.exe',
      args: ['-NoProfile', '-Command', command],
    };
  }

  return {
    shell: 'bash',
    args: ['-lc', command],
  };
}
