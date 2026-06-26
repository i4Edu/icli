import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Snippet {
  name: string;
  body: string;
  updatedAt: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function snippetsDir(): string {
  return process.env.ICOPILOT_SNIPPETS_DIR || path.join(os.homedir(), '.icopilot', 'snippets');
}

export function listSnippets(): Snippet[] {
  const dir = snippetsDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => readSnippet(path.basename(entry.name, '.md')))
    .filter((snippet): snippet is Snippet => snippet !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveSnippet(name: string, body: string): Snippet {
  assertValidName(name);
  const dir = snippetsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = snippetPath(name);
  fs.writeFileSync(file, body, 'utf8');
  return snippetFromFile(name, file);
}

export function readSnippet(name: string): Snippet | null {
  assertValidName(name);
  const file = snippetPath(name);
  if (!fs.existsSync(file)) return null;
  return snippetFromFile(name, file);
}

export function deleteSnippet(name: string): boolean {
  assertValidName(name);
  const file = snippetPath(name);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function expandSnippet(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error('Invalid snippet name. Use 1-64 letters, numbers, underscores, or dashes; start with a letter or number.');
  }
}

function snippetPath(name: string): string {
  return path.join(snippetsDir(), `${name}.md`);
}

function snippetFromFile(name: string, file: string): Snippet {
  const stat = fs.statSync(file);
  return {
    name,
    body: fs.readFileSync(file, 'utf8'),
    updatedAt: stat.mtime.toISOString(),
  };
}
