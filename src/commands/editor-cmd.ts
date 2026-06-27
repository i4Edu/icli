import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../config.js';

const WINDOWS_FALLBACK_EDITOR = 'code --wait';
const UNIX_FALLBACK_EDITOR = 'vim';

function detectEditor(): string {
  const visual = process.env.VISUAL?.trim();
  if (visual) return visual;

  const editor = process.env.EDITOR?.trim();
  if (editor) return editor;

  return process.platform === 'win32' ? WINDOWS_FALLBACK_EDITOR : UNIX_FALLBACK_EDITOR;
}

function resolveEditorWorkspace(): string {
  const candidate = config.cwd || process.cwd();
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  return process.cwd();
}

function createTempFilePath(cwd: string): string {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(cwd, `.icopilot-editor-${nonce}.md`);
}

export async function openEditor(): Promise<string | null> {
  const cwd = resolveEditorWorkspace();
  const editor = detectEditor();
  const tempFilePath = createTempFilePath(cwd);

  fs.writeFileSync(tempFilePath, '', 'utf8');

  try {
    const escapedPath = `"${tempFilePath.replace(/"/g, '\\"')}"`;
    const result = spawnSync(`${editor} ${escapedPath}`, {
      cwd,
      shell: true,
      stdio: 'inherit',
    });

    if (result.error) throw result.error;
    if (result.status !== 0 || result.signal) return null;

    const content = fs.readFileSync(tempFilePath, 'utf8').trim();
    return content ? content : null;
  } finally {
    fs.rmSync(tempFilePath, { force: true });
  }
}
