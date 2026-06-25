import fs from 'node:fs';
import path from 'node:path';
import { createPatch } from 'diff';
import { confirm } from '@inquirer/prompts';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { toolMemory } from './memory.js';
import { loadPolicy, writePathAllowed } from './policy.js';
import { assertSandbox } from './sandbox.js';

export interface WriteResult {
  wrote: boolean;
  path: string;
  bytes: number;
  error?: string;
}

/** Show a unified diff and ask the user before writing the file. */
export async function proposeWrite(relPath: string, newContent: string): Promise<WriteResult> {
  const abs = path.resolve(config.cwd, relPath);
  const denied = ensureWriteAllowed(abs);
  if (denied) {
    process.stdout.write(theme.err(`  ${denied}\n`));
    return { wrote: false, path: abs, bytes: 0, error: denied };
  }

  let old = '';
  let exists = false;
  try {
    old = fs.readFileSync(abs, 'utf8');
    exists = true;
  } catch {
    /* new file */
  }

  const patch = createPatch(relPath, old, newContent, exists ? 'current' : 'empty', 'proposed');
  process.stdout.write('\n' + theme.badge('WRITE') + ` ${relPath}\n`);
  process.stdout.write(colorizePatch(patch) + '\n');

  const remembered = toolMemory.isWriteRemembered(abs);
  const ok =
    remembered ||
    (await confirm({
      message: exists ? 'Apply this patch?' : 'Create this new file?',
      default: false,
    }).catch(() => false));

  if (!ok) {
    process.stdout.write(theme.warn('  skipped.\n'));
    return { wrote: false, path: abs, bytes: 0 };
  }

  if (!remembered) {
    const remember = await confirm({
      message: 'Remember this write path for the session?',
      default: false,
    }).catch(() => false);
    if (remember) toolMemory.rememberWrite(abs);
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, newContent, 'utf8');
  process.stdout.write(theme.ok(`  ✔ wrote ${relPath}\n`));
  return { wrote: true, path: abs, bytes: Buffer.byteLength(newContent) };
}

export async function proposeWriteBatch(
  items: Array<{ path: string; content: string }>,
): Promise<{ wrote: boolean; results: WriteResult[] }> {
  const prepared: Array<{
    relPath: string;
    abs: string;
    content: string;
    old: string;
    exists: boolean;
  }> = [];

  for (const item of items) {
    const abs = path.resolve(config.cwd, item.path);
    const denied = ensureWriteAllowed(abs);
    if (denied) {
      process.stdout.write(theme.err(`  ${denied}\n`));
      return { wrote: false, results: [{ wrote: false, path: abs, bytes: 0, error: denied }] };
    }
    let old = '';
    let exists = false;
    try {
      old = fs.readFileSync(abs, 'utf8');
      exists = true;
    } catch {
      /* new file */
    }
    prepared.push({ relPath: item.path, abs, content: item.content, old, exists });
  }

  process.stdout.write('\n' + theme.badge('WRITE BATCH') + ` ${prepared.length} files\n`);
  for (const item of prepared) {
    const patch = createPatch(
      item.relPath,
      item.old,
      item.content,
      item.exists ? 'current' : 'empty',
      'proposed',
    );
    process.stdout.write(colorizePatch(patch) + '\n');
  }

  const remembered = prepared.every((item) => toolMemory.isWriteRemembered(item.abs));
  const ok =
    remembered ||
    (await confirm({
      message: 'Apply all patches?',
      default: false,
    }).catch(() => false));

  if (!ok) {
    process.stdout.write(theme.warn('  skipped.\n'));
    return {
      wrote: false,
      results: prepared.map((item) => ({ wrote: false, path: item.abs, bytes: 0 })),
    };
  }

  if (!remembered) {
    const remember = await confirm({
      message: 'Remember these write paths for the session?',
      default: false,
    }).catch(() => false);
    if (remember) prepared.forEach((item) => toolMemory.rememberWrite(item.abs));
  }

  const results: WriteResult[] = [];
  const written: typeof prepared = [];
  try {
    for (const item of prepared) {
      fs.mkdirSync(path.dirname(item.abs), { recursive: true });
      fs.writeFileSync(item.abs, item.content, 'utf8');
      written.push(item);
      results.push({ wrote: true, path: item.abs, bytes: Buffer.byteLength(item.content) });
    }
    return { wrote: true, results };
  } catch (e: any) {
    const error = e?.message || String(e);
    for (const item of written.reverse()) {
      try {
        if (item.exists) fs.writeFileSync(item.abs, item.old, 'utf8');
        else if (fs.existsSync(item.abs)) fs.unlinkSync(item.abs);
      } catch {
        /* best-effort rollback */
      }
    }
    return {
      wrote: false,
      results: [
        ...results.map((result) => ({ ...result, wrote: false })),
        { wrote: false, path: '', bytes: 0, error },
      ],
    };
  }
}

export function readFileSafe(relPath: string): string {
  const abs = path.resolve(config.cwd, relPath);
  assertSandbox(abs, config.cwd);
  return fs.readFileSync(abs, 'utf8');
}

function ensureWriteAllowed(abs: string): string | undefined {
  try {
    assertSandbox(abs, config.cwd);
  } catch (e: any) {
    return e?.message || String(e);
  }
  if (!writePathAllowed(abs, loadPolicy(config.cwd), config.cwd)) return 'policy denied';
  return undefined;
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
