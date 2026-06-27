import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, spawnSync, type ExecFileOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam as Message } from 'openai/resources/chat/completions';
import { config } from '../config.js';

export interface ClipboardReadResult {
  type: 'text' | 'image';
  content: string;
}

const CLIPBOARD_DIR = '.icopilot-clipboard';
const IMAGE_MARKER = '__ICLI_IMAGE__';
const MAX_BUFFER = 20 * 1024 * 1024;

export async function readClipboard(): Promise<ClipboardReadResult> {
  switch (process.platform) {
    case 'win32':
      return readClipboardWindows();
    case 'darwin':
      return readClipboardMacOS();
    default:
      return readClipboardLinux();
  }
}

export async function pasteToChat(): Promise<string> {
  const clipboard = await readClipboard();
  return clipboard.type === 'image' ? `"${clipboard.content}"` : clipboard.content;
}

export async function copyContextToClipboard(messages: Message[]): Promise<void> {
  await copyTextToClipboard(formatMessagesAsMarkdown(messages));
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await writeClipboardText('clip.exe', [], text);
      return;
    } catch {
      await writeClipboardText(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
        text,
      );
      return;
    }
  }

  if (process.platform === 'darwin') {
    await writeClipboardText('pbcopy', [], text);
    return;
  }

  if (commandExists('xclip')) {
    await writeClipboardText('xclip', ['-selection', 'clipboard'], text);
    return;
  }
  if (commandExists('xsel')) {
    await writeClipboardText('xsel', ['--clipboard', '--input'], text);
    return;
  }
  throw new Error('No clipboard utility found (expected xclip or xsel).');
}

export function formatMessagesAsMarkdown(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const role = capitalize(typeof message.role === 'string' ? message.role : 'message');
    lines.push(
      `## ${role}`,
      '',
      contentToText((message as { content?: unknown }).content).trim() || '_[no content]_',
      '',
      '---',
      '',
    );
  }
  return lines.join('\n').trimEnd() + '\n';
}

async function readClipboardWindows(): Promise<ClipboardReadResult> {
  const imagePath = createClipboardArtifactPath('.png');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$target = $args[0]',
    'if ([System.Windows.Forms.Clipboard]::ContainsImage()) {',
    '  $image = [System.Windows.Forms.Clipboard]::GetImage()',
    '  if ($null -ne $image) {',
    '    $image.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)',
    `    Write-Output "${IMAGE_MARKER}$target"`,
    '    exit 0',
    '  }',
    '}',
    'if ([System.Windows.Forms.Clipboard]::ContainsText()) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Get-Clipboard -Raw',
    '  exit 0',
    '}',
    'exit 2',
  ].join('; ');
  const { stdout } = await runExecFile(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', script, imagePath],
    { encoding: 'utf8' },
  );
  return parseClipboardOutput(String(stdout));
}

async function readClipboardMacOS(): Promise<ClipboardReadResult> {
  if (commandExists('pngpaste')) {
    const imagePath = createClipboardArtifactPath('.png');
    try {
      await runExecFile('pngpaste', [imagePath], { encoding: 'buffer' });
      if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
        return { type: 'image', content: imagePath };
      }
    } catch {
      cleanupFile(imagePath);
    }
  }
  const { stdout } = await runExecFile('pbpaste', [], { encoding: 'utf8' });
  return { type: 'text', content: trimTrailingNewline(String(stdout)) };
}

async function readClipboardLinux(): Promise<ClipboardReadResult> {
  if (commandExists('xclip')) {
    const imagePath = createClipboardArtifactPath('.png');
    try {
      const { stdout } = await runExecFile(
        'xclip',
        ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        { encoding: 'buffer' },
      );
      const buffer = asBuffer(stdout);
      if (buffer.length > 0) {
        fs.writeFileSync(imagePath, buffer);
        return { type: 'image', content: imagePath };
      }
    } catch {
      cleanupFile(imagePath);
    }
  }

  if (commandExists('xclip')) {
    const { stdout } = await runExecFile('xclip', ['-selection', 'clipboard', '-o'], {
      encoding: 'utf8',
    });
    return { type: 'text', content: trimTrailingNewline(String(stdout)) };
  }
  if (commandExists('xsel')) {
    const { stdout } = await runExecFile('xsel', ['--clipboard', '--output'], { encoding: 'utf8' });
    return { type: 'text', content: trimTrailingNewline(String(stdout)) };
  }
  throw new Error('No clipboard utility found (expected xclip or xsel).');
}

function parseClipboardOutput(stdout: string): ClipboardReadResult {
  const trimmed = trimTrailingNewline(stdout);
  if (trimmed.startsWith(IMAGE_MARKER)) {
    return { type: 'image', content: trimmed.slice(IMAGE_MARKER.length).trim() };
  }
  return { type: 'text', content: trimmed };
}

function createClipboardArtifactPath(extension: string): string {
  const dir = path.join(config.cwd || process.cwd(), CLIPBOARD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `clipboard-${Date.now()}-${randomUUID()}${extension}`);
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

function cleanupFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* ignore cleanup errors */
  }
}

function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
}

function writeClipboardText(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `clipboard command exited with code ${code}`));
      }
    });
    child.stdin.end(text);
  });
}

function runExecFile(
  command: string,
  args: string[],
  options: ExecFileOptions & { encoding?: BufferEncoding | 'buffer' } = {},
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          stdout: stdout as string | Buffer,
          stderr: stderr as string | Buffer,
        });
      },
    );
  });
}

function asBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.type === 'string') return JSON.stringify(part);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
