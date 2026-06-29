import fs from 'node:fs';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { createPatch } from 'diff';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { hookManager } from '../hooks/lifecycle.js';
import { theme } from '../ui/theme.js';
import { formatAutoCheckResult, runAutoLint, type AutoCheckResult } from './auto-check.js';
import { toolMemory } from './memory.js';
import { loadPolicy, writePathAllowed } from './policy.js';
import { assertSandbox } from './sandbox.js';
import { ensureWriteAllowed } from './file-ops.js';

export interface FileEdit {
  file: string;
  edits: { oldText: string; newText: string }[];
}

export interface MultiEditPlan {
  description: string;
  files: FileEdit[];
  rollbackable: boolean;
}

export interface MultiEditPreview {
  files: { path: string; diff: string }[];
  totalChanges: number;
}

export interface MultiEditResult {
  success: boolean;
  applied: string[];
  failed?: { file: string; error: string }[];
}

interface PreparedFileEdit {
  path: string;
  absPath: string;
  existed: boolean;
  originalContent: string;
  nextContent: string;
  diff: string;
}

interface RollbackContext {
  files: PreparedFileEdit[];
  active: boolean;
}

const rollbackContexts = new WeakMap<MultiEditResult, RollbackContext>();

export const multiEditSchema: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'multi_edit',
    description:
      'Preview and atomically apply coordinated text replacements across multiple files, rolling back all changes if any file write fails.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Short description of the coordinated edit operation.',
        },
        rollbackable: {
          type: 'boolean',
          description: 'Whether a successful edit should remain eligible for manual rollback.',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: {
                type: 'string',
                description: 'Repository-relative file path to edit.',
              },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    oldText: { type: 'string' },
                    newText: { type: 'string' },
                  },
                  required: ['oldText', 'newText'],
                },
              },
            },
            required: ['file', 'edits'],
          },
        },
      },
      required: ['description', 'files', 'rollbackable'],
    },
  },
};

export function planMultiEdit(plan: MultiEditPlan): MultiEditPreview {
  return prepareMultiEdit(plan).preview;
}

export function applyMultiEdit(plan: MultiEditPlan): MultiEditResult {
  const { prepared } = prepareMultiEdit(plan);
  return applyPreparedMultiEdit(prepared, plan.rollbackable);
}

export function rollbackMultiEdit(result: MultiEditResult): void {
  const context = rollbackContexts.get(result);
  if (!context?.active) return;

  const failed = result.failed ? [...result.failed] : [];
  const applied = new Set(result.applied);
  for (const file of [...context.files].reverse()) {
    if (!applied.has(file.path)) continue;
    try {
      if (file.existed) {
        fs.mkdirSync(path.dirname(file.absPath), { recursive: true });
        fs.writeFileSync(file.absPath, file.originalContent, 'utf8');
      } else if (fs.existsSync(file.absPath)) {
        fs.unlinkSync(file.absPath);
      }
    } catch (error: unknown) {
      failed.push({
        file: file.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  context.active = false;
  rollbackContexts.delete(result);
  result.applied = [];
  result.failed = failed.length ? failed : undefined;
}

export async function multiEditTool(rawPlan: MultiEditPlan): Promise<string> {
  try {
    const plan = normalizePlan(rawPlan);
    const { prepared, preview } = prepareMultiEdit(plan);

    displayPreview(plan.description, preview);
    const approved = await confirmMultiEdit(prepared.map((file) => file.absPath));
    if (!approved) {
      return JSON.stringify({
        success: false,
        applied: [],
        failed: [{ file: '*', error: 'multi_edit cancelled' }],
        preview,
      });
    }

    const result = applyPreparedMultiEdit(prepared, plan.rollbackable);
    const autoLint = result.success ? await maybeRunAutoLint(result.applied) : undefined;
    return JSON.stringify({ ...result, preview, ...(autoLint ? { autoLint } : {}) });
  } catch (error: unknown) {
    return JSON.stringify({
      success: false,
      applied: [],
      failed: [{ file: '*', error: error instanceof Error ? error.message : String(error) }],
    });
  }
}

function normalizePlan(rawPlan: MultiEditPlan): MultiEditPlan {
  return {
    description: String(rawPlan.description ?? ''),
    rollbackable: Boolean(rawPlan.rollbackable),
    files: Array.isArray(rawPlan.files)
      ? rawPlan.files.map((file) => ({
          file: String(file.file ?? ''),
          edits: Array.isArray(file.edits)
            ? file.edits.map((edit) => ({
                oldText: String(edit.oldText ?? ''),
                newText: String(edit.newText ?? ''),
              }))
            : [],
        }))
      : [],
  };
}

function prepareMultiEdit(plan: MultiEditPlan): {
  prepared: PreparedFileEdit[];
  preview: MultiEditPreview;
} {
  if (!plan.files.length) {
    throw new Error('multi_edit requires at least one file');
  }

  const policy = loadPolicy(config.cwd);
  const prepared = plan.files.map((filePlan) => {
    if (!filePlan.file.trim()) {
      throw new Error('multi_edit file path must not be empty');
    }
    if (!filePlan.edits.length) {
      throw new Error(`multi_edit requires at least one edit for ${filePlan.file}`);
    }

    const absPath = path.resolve(config.cwd, filePlan.file);
    const denied = ensureWriteAllowed(absPath);
    if (denied) throw new Error(`${denied}: ${filePlan.file}`);
    assertSandbox(absPath, config.cwd);
    if (!writePathAllowed(absPath, policy, config.cwd))
      throw new Error(`policy denied: ${filePlan.file}`);
    if (!fs.existsSync(absPath)) {
      throw new Error(`file not found: ${filePlan.file}`);
    }

    const originalContent = fs.readFileSync(absPath, 'utf8');
    const nextContent = applyEdits(filePlan.file, originalContent, filePlan.edits);
    const diff = createPatch(filePlan.file, originalContent, nextContent, 'current', 'proposed');

    return {
      path: filePlan.file,
      absPath,
      existed: true,
      originalContent,
      nextContent,
      diff,
    };
  });

  return {
    prepared,
    preview: {
      files: prepared.map((file) => ({ path: file.path, diff: file.diff })),
      totalChanges: plan.files.reduce((total, file) => total + file.edits.length, 0),
    },
  };
}

function applyPreparedMultiEdit(
  prepared: PreparedFileEdit[],
  rollbackable: boolean,
): MultiEditResult {
  const result: MultiEditResult = { success: false, applied: [] };
  const rollbackContext: RollbackContext = { files: prepared, active: true };
  rollbackContexts.set(result, rollbackContext);

  for (const file of prepared) {
    try {
      fs.mkdirSync(path.dirname(file.absPath), { recursive: true });
      fs.writeFileSync(file.absPath, file.nextContent, 'utf8');
      void hookManager.emit('fileChanged', {
        cwd: config.cwd,
        path: file.path,
        absolutePath: file.absPath,
        bytes: Buffer.byteLength(file.nextContent),
      });
      result.applied.push(file.path);
    } catch (error: unknown) {
      result.failed = [
        {
          file: file.path,
          error: error instanceof Error ? error.message : String(error),
        },
      ];
      rollbackMultiEdit(result);
      return result;
    }
  }

  result.success = true;
  if (!rollbackable) {
    rollbackContext.active = false;
    rollbackContexts.delete(result);
  }
  return result;
}

function applyEdits(
  file: string,
  source: string,
  edits: Array<{ oldText: string; newText: string }>,
): string {
  let next = source;

  edits.forEach((edit, index) => {
    if (!edit.oldText) {
      throw new Error(`edit ${index + 1} for ${file} must include a non-empty oldText`);
    }

    const matches = countOccurrences(next, edit.oldText);
    if (matches === 0) {
      throw new Error(`edit ${index + 1} for ${file} could not find oldText`);
    }
    if (matches > 1) {
      throw new Error(`edit ${index + 1} for ${file} matched multiple locations`);
    }

    next = next.replace(edit.oldText, edit.newText);
  });

  return next;
}

function countOccurrences(source: string, target: string): number {
  if (!target) return 0;

  let count = 0;
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(target, offset);
    if (index === -1) break;
    count += 1;
    offset = index + target.length;
  }
  return count;
}

async function confirmMultiEdit(paths: string[]): Promise<boolean> {
  const remembered = paths.every((file) => toolMemory.isWriteRemembered(file));
  const approved =
    config.autoApprove ||
    remembered ||
    (await confirm({ message: 'Apply all patches?', default: false }).catch(() => false));

  if (!approved) {
    if (!config.jsonOutput) process.stdout.write(theme.warn('  skipped.\n'));
    return false;
  }

  if (!config.autoApprove && !remembered) {
    const remember = await confirm({
      message: 'Remember these write paths for the session?',
      default: false,
    }).catch(() => false);
    if (remember) paths.forEach((file) => toolMemory.rememberWrite(file));
  }

  return true;
}

function displayPreview(description: string, preview: MultiEditPreview): void {
  if (config.quiet || config.jsonOutput) return;

  process.stdout.write(
    `\n${theme.badge('MULTI EDIT')} ${description || 'Coordinated multi-file edit'}\n`,
  );
  process.stdout.write(
    theme.dim(`${preview.files.length} files, ${preview.totalChanges} text changes\n`),
  );
  for (const file of preview.files) {
    process.stdout.write(colorizePatch(file.diff) + '\n');
  }
}

async function maybeRunAutoLint(changedFiles: string[]): Promise<AutoCheckResult | undefined> {
  if (!config.autoLint || changedFiles.length === 0) return undefined;
  const result = await runAutoLint(changedFiles);
  if (!config.quiet && !config.jsonOutput) {
    process.stdout.write(`${theme.dim(formatAutoCheckResult('lint', result, changedFiles))}\n`);
  }
  return result;
}

function colorizePatch(patch: string): string {
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return theme.dim(line);
      if (line.startsWith('+')) return theme.ok(line);
      if (line.startsWith('-')) return theme.err(line);
      if (line.startsWith('@@')) return theme.hl(line);
      return line;
    })
    .join('\n');
}
