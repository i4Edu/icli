import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { proposeWrite } from './file-ops.js';

export interface EditFileArgs {
  path: string;
  startLine: number;
  endLine: number;
  newContent: string;
}

export interface EditFileResult {
  ok: boolean;
  linesReplaced: number;
  newLineCount: number;
  error?: string;
}

export async function editFileTool(args: EditFileArgs): Promise<string> {
  const startLine = Number(args.startLine);
  const endLine = Number(args.endLine);
  const newLines = args.newContent.split('\n');
  const linesReplaced =
    Number.isInteger(startLine) && Number.isInteger(endLine) ? endLine - startLine + 1 : 0;

  try {
    if (!Number.isInteger(startLine)) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, 'startLine must be an integer'),
      );
    }
    if (!Number.isInteger(endLine)) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, 'endLine must be an integer'),
      );
    }
    if (startLine < 1) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, 'startLine must be >= 1'),
      );
    }
    if (endLine < startLine) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, 'endLine must be >= startLine'),
      );
    }

    const abs = path.resolve(config.cwd, args.path);
    if (!fs.existsSync(abs)) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, `file not found: ${args.path}`),
      );
    }

    const current = fs.readFileSync(abs, 'utf8');
    const lines = current.split('\n');
    if (endLine > lines.length) {
      return JSON.stringify(
        result(
          false,
          linesReplaced,
          newLines.length,
          `line range ${startLine}-${endLine} is out of bounds for ${lines.length}-line file`,
        ),
      );
    }

    const updated = [...lines.slice(0, startLine - 1), ...newLines, ...lines.slice(endLine)].join(
      '\n',
    );

    const write = await proposeWrite(args.path, updated);
    if (!write.wrote) {
      return JSON.stringify(
        result(false, linesReplaced, newLines.length, write.error || 'edit rejected'),
      );
    }

    return JSON.stringify(result(true, linesReplaced, newLines.length));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return JSON.stringify(result(false, linesReplaced, newLines.length, message));
  }
}

export const EDIT_FILE_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'Edit specific lines of a file. More efficient than rewriting the whole file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
        newContent: { type: 'string' },
      },
      required: ['path', 'startLine', 'endLine', 'newContent'],
    },
  },
};

function result(
  ok: boolean,
  linesReplaced: number,
  newLineCount: number,
  error?: string,
): EditFileResult {
  return error ? { ok, linesReplaced, newLineCount, error } : { ok, linesReplaced, newLineCount };
}
