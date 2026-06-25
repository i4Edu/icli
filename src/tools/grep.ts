import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { config } from '../config.js';
import { assertSandbox } from './sandbox.js';

export interface GrepArgs {
  pattern: string;
  path?: string;
  regex?: boolean;
  ignoreCase?: boolean;
  maxResults?: number;
}

export async function grepTool(args: GrepArgs): Promise<string> {
  const root = path.resolve(config.cwd, args.path || '.');
  assertSandbox(root, config.cwd);
  const maxResults = args.maxResults ?? 200;
  const matcher = createMatcher(args.pattern, Boolean(args.regex), Boolean(args.ignoreCase));
  const files = await fg('**/*', {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  });

  const matches: Array<{ file: string; line: number; text: string }> = [];
  let truncated = false;
  for (const file of files) {
    if (matches.length >= maxResults) {
      truncated = true;
      break;
    }
    const abs = path.join(root, file);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (matcher(lines[i] || '')) {
        matches.push({
          file: path.relative(config.cwd, abs),
          line: i + 1,
          text: lines[i] || '',
        });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }
  }
  return JSON.stringify({ matches, truncated });
}

function createMatcher(
  pattern: string,
  regex: boolean,
  ignoreCase: boolean,
): (line: string) => boolean {
  if (regex) {
    const re = new RegExp(pattern, ignoreCase ? 'i' : '');
    return (line) => re.test(line);
  }
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
}
