import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { assertSandbox } from './sandbox.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024;
const TRUNCATION_NOTE = '\n…[output truncated after 10KB]';

export interface RunInTerminalArgs {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface RunInTerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export const runInTerminalSchema: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_in_terminal',
    description:
      'Run a terminal command immediately with streamed stdout/stderr, optional cwd/env overrides, and timeout protection.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command line to execute.',
        },
        cwd: {
          type: 'string',
          description:
            'Optional working directory, relative to the current workspace unless absolute.',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Defaults to 30000.',
          default: DEFAULT_TIMEOUT_MS,
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Optional environment variable overrides.',
        },
      },
      required: ['command'],
    },
  },
};

export async function runInTerminal(args: RunInTerminalArgs): Promise<RunInTerminalResult> {
  const cwd = path.resolve(config.cwd, args.cwd || '.');
  const timeoutMs = normalizeTimeout(args.timeout);
  const env = {
    ...process.env,
    ...sanitizeEnv(args.env),
  };

  try {
    assertSandbox(cwd, config.cwd);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: message,
      exitCode: -1,
      timedOut: false,
      truncated: false,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(args.command, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let capturedBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const onStdout = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (!config.jsonOutput) process.stdout.write(text);
      const result = appendOutput(stdout, text, capturedBytes, truncated);
      stdout = result.output;
      capturedBytes = result.capturedBytes;
      truncated = result.truncated;
    };

    const onStderr = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (!config.jsonOutput) process.stderr.write(text);
      const result = appendOutput(stderr, text, capturedBytes, truncated);
      stderr = result.output;
      capturedBytes = result.capturedBytes;
      truncated = result.truncated;
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const result = appendOutput(stderr, error.message, capturedBytes, truncated);
      resolve({
        stdout,
        stderr: result.output,
        exitCode: -1,
        timedOut,
        truncated: result.truncated,
      });
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
        truncated,
      });
    });
  });
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function normalizeTimeout(timeout: number | undefined): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(timeout);
}

function appendOutput(
  current: string,
  chunk: string,
  capturedBytes: number,
  alreadyTruncated: boolean,
): { output: string; capturedBytes: number; truncated: boolean } {
  if (alreadyTruncated || chunk.length === 0) {
    return { output: current, capturedBytes, truncated: alreadyTruncated };
  }

  const availableBytes = MAX_OUTPUT_BYTES - capturedBytes;
  if (availableBytes <= 0) {
    return { output: withTruncationNote(current), capturedBytes, truncated: true };
  }

  const chunkBytes = Buffer.byteLength(chunk);
  if (chunkBytes <= availableBytes) {
    return {
      output: current + chunk,
      capturedBytes: capturedBytes + chunkBytes,
      truncated: false,
    };
  }

  const chunkBuffer = Buffer.from(chunk);
  const visible = chunkBuffer.subarray(0, availableBytes).toString('utf8');
  return {
    output: withTruncationNote(current + visible),
    capturedBytes: MAX_OUTPUT_BYTES,
    truncated: true,
  };
}

function withTruncationNote(output: string): string {
  return output.endsWith(TRUNCATION_NOTE) ? output : output + TRUNCATION_NOTE;
}
