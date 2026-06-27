import fs from 'node:fs';
import path from 'node:path';
import { countTokensSync } from '../util/tokens.js';

export interface PinnedFile {
  path: string;
  addedAt: string;
  tokens: number;
}

export class PinnedContext {
  private files: PinnedFile[];

  constructor(files: PinnedFile[] = []) {
    this.files = [...files];
  }

  add(filePath: string, cwd: string): PinnedFile | null {
    const resolvedPath = path.resolve(cwd, filePath);

    try {
      if (!fs.statSync(resolvedPath).isFile()) return null;
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const pinnedFile: PinnedFile = {
        path: resolvedPath,
        addedAt: new Date().toISOString(),
        tokens: countTokensSync(content),
      };

      const existingIndex = this.files.findIndex((file) => file.path === resolvedPath);
      if (existingIndex >= 0) {
        this.files[existingIndex] = pinnedFile;
      } else {
        this.files.push(pinnedFile);
      }

      return pinnedFile;
    } catch {
      return null;
    }
  }

  remove(filePath: string): boolean {
    const normalizedTarget = path.normalize(filePath);
    const nextFiles = this.files.filter((file) => path.normalize(file.path) !== normalizedTarget);
    const removed = nextFiles.length !== this.files.length;
    this.files = nextFiles;
    return removed;
  }

  list(): PinnedFile[] {
    return [...this.files];
  }

  clear(): number {
    const count = this.files.length;
    this.files = [];
    return count;
  }

  render(): string {
    if (!this.files.length) return '';

    const parts: string[] = ['### Pinned context files'];
    for (const file of this.files) {
      parts.push('');
      parts.push(`#### ${file.path}`);

      try {
        const content = fs.readFileSync(file.path, 'utf8');
        const language = path.extname(file.path).replace(/^\./, '');
        parts.push(`\`\`\`${language}`);
        parts.push(content);
        parts.push('```');
      } catch {
        parts.push('_[error: unable to read file]_');
      }
    }

    return parts.join('\n');
  }

  totalTokens(): number {
    return this.files.reduce((total, file) => total + file.tokens, 0);
  }

  toJSON(): PinnedFile[] {
    return this.list();
  }

  static fromJSON(data: unknown): PinnedContext {
    if (!Array.isArray(data)) return new PinnedContext();

    const files = data.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];

      const candidate = entry as Partial<PinnedFile>;
      if (
        typeof candidate.path !== 'string' ||
        typeof candidate.addedAt !== 'string' ||
        typeof candidate.tokens !== 'number'
      ) {
        return [];
      }

      return [
        {
          path: candidate.path,
          addedAt: candidate.addedAt,
          tokens: candidate.tokens,
        },
      ];
    });

    return new PinnedContext(files);
  }
}
