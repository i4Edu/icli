import fs from 'node:fs';
import path from 'node:path';
import { checkbox } from '@inquirer/prompts';
import { applyPatch, parsePatch } from 'diff';
import type { Hunk, ParsedDiff } from 'diff';
import { config } from '../config.js';
import { hookManager } from '../hooks/lifecycle.js';
import { theme } from '../ui/theme.js';
import { formatAutoCheckResult, runAutoLint, type AutoCheckResult } from './auto-check.js';
import { loadPolicy, writePathAllowed } from './policy.js';
import { assertSandbox } from './sandbox.js';
import { toolMemory } from './memory.js';
import { ensureWriteAllowed } from './file-ops.js';

interface ApplyPatchArgs {
  patch: string;
}

export async function applyPatchTool(args: ApplyPatchArgs): Promise<string> {
  const parsed = parsePatch(args.patch);
  process.stdout.write('\n' + theme.badge('PATCH') + '\n');
  process.stdout.write(colorizePatch(args.patch) + '\n');

  const choices = parsed.flatMap((filePatch, fileIndex) =>
    filePatch.hunks.map((hunk, hunkIndex) => ({
      name: `${displayPath(filePatch)} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`,
      value: `${fileIndex}:${hunkIndex}`,
      checked: true,
    })),
  );

  const selected = new Set(
    choices.length
      ? await checkbox<string>({
          message: 'Select hunks to apply',
          choices,
        }).catch(() => [])
      : [],
  );

  const policy = loadPolicy(config.cwd);
  const applied: Array<{ path: string; hunks: number[] }> = [];
  const skipped: Array<{ path: string; hunks: number[]; reason: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (let fileIndex = 0; fileIndex < parsed.length; fileIndex += 1) {
    const filePatch = parsed[fileIndex];
    if (!filePatch) continue;
    const selectedHunks = filePatch.hunks
      .map((hunk, hunkIndex) => ({ hunk, hunkIndex }))
      .filter(({ hunkIndex }) => selected.has(`${fileIndex}:${hunkIndex}`));
    const unselected = filePatch.hunks
      .map((_, hunkIndex) => hunkIndex)
      .filter((hunkIndex) => !selected.has(`${fileIndex}:${hunkIndex}`));
    if (unselected.length) {
      skipped.push({ path: displayPath(filePatch), hunks: unselected, reason: 'not selected' });
    }
    if (!selectedHunks.length) continue;

    const relPath = normalizePatchPath(displayPath(filePatch));
    const abs = path.resolve(config.cwd, relPath);
    try {
      const denied = ensureWriteAllowed(abs);
      if (denied) {
        skipped.push({
          path: relPath,
          hunks: selectedHunks.map(({ hunkIndex }) => hunkIndex),
          reason: denied,
        });
        continue;
      }
      assertSandbox(abs, config.cwd);
      if (!toolMemory.isWriteRemembered(abs) && !writePathAllowed(abs, policy, config.cwd)) {
        skipped.push({
          path: relPath,
          hunks: selectedHunks.map(({ hunkIndex }) => hunkIndex),
          reason: 'policy denied',
        });
        continue;
      }
      const oldContent = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const partial = clonePatchWithHunks(
        filePatch,
        selectedHunks.map(({ hunk }) => hunk),
      );
      const next = applyPatch(oldContent, partial);
      if (next === false) {
        errors.push({ path: relPath, error: 'patch did not apply' });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, next, 'utf8');
      await hookManager.emit('fileChanged', {
        cwd: config.cwd,
        path: relPath,
        absolutePath: abs,
      });
      applied.push({ path: relPath, hunks: selectedHunks.map(({ hunkIndex }) => hunkIndex) });
    } catch (e: any) {
      errors.push({ path: relPath, error: e?.message || String(e) });
    }
  }

  const changedFiles = applied.map((entry) => entry.path);
  const autoLint = errors.length === 0 ? await maybeRunAutoLint(changedFiles) : undefined;
  return JSON.stringify({ applied, skipped, errors, ...(autoLint ? { autoLint } : {}) });
}

function clonePatchWithHunks(filePatch: ParsedDiff, hunks: Hunk[]): ParsedDiff {
  return {
    ...filePatch,
    hunks: hunks.map((hunk) => ({
      ...hunk,
      lines: [...hunk.lines],
      linedelimiters: hunk.linedelimiters ? [...hunk.linedelimiters] : undefined,
    })),
  };
}

function displayPath(filePatch: ParsedDiff): string {
  return filePatch.newFileName && filePatch.newFileName !== '/dev/null'
    ? filePatch.newFileName
    : filePatch.oldFileName || '';
}

function normalizePatchPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^(a|b)\//, '');
}

function colorizePatch(p: string): string {
  return p
    .split('\n')
    .map((l) => {
      if (l.startsWith('+++') || l.startsWith('---')) return theme.dim(l);
      if (l.startsWith('+')) return theme.ok(l);
      if (l.startsWith('-')) return theme.err(l);
      if (l.startsWith('@@')) return theme.hl(l);
      return l;
    })
    .join('\n');
}

async function maybeRunAutoLint(changedFiles: string[]): Promise<AutoCheckResult | undefined> {
  if (!config.autoLint || changedFiles.length === 0) return undefined;
  const result = await runAutoLint(changedFiles);
  if (!config.quiet && !config.jsonOutput) {
    process.stdout.write(`${theme.dim(formatAutoCheckResult('lint', result, changedFiles))}\n`);
  }
  return result;
}
