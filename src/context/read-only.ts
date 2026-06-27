import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const readOnlyFiles = new Set<string>();

export function addReadOnly(filePath: string): string {
  const resolvedPath = path.resolve(config.cwd, filePath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`file not found: ${resolvedPath}`);
  }
  readOnlyFiles.add(path.normalize(resolvedPath));
  return resolvedPath;
}

export function removeReadOnly(filePath: string): boolean {
  return readOnlyFiles.delete(path.normalize(path.resolve(config.cwd, filePath)));
}

export function isReadOnly(filePath: string): boolean {
  return readOnlyFiles.has(path.normalize(path.resolve(config.cwd, filePath)));
}

export function getReadOnlyFiles(): string[] {
  return [...readOnlyFiles].sort((left, right) => left.localeCompare(right));
}

export function getReadOnlyContext(): string {
  const files = getReadOnlyFiles();
  if (!files.length) return '';

  const parts = [
    '### Read-only context files',
    '',
    'These files are available for context only. Do not modify them.',
  ];

  for (const file of files) {
    parts.push('', `#### ${file} (read-only)`);
    try {
      const content = fs.readFileSync(file, 'utf8');
      const language = path.extname(file).replace(/^\./, '');
      parts.push(`\`\`\`${language}`);
      parts.push(content);
      parts.push('```');
    } catch {
      parts.push('_[error: unable to read file]_');
    }
  }

  return parts.join('\n');
}

export function clearReadOnly(): void {
  readOnlyFiles.clear();
}
