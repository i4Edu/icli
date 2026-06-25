import path from 'node:path';
import fg from 'fast-glob';
import { config } from '../config.js';
import { assertSandbox } from './sandbox.js';

export interface GlobArgs {
  pattern: string;
  cwd?: string;
  ignore?: string[];
}

export async function globTool(args: GlobArgs): Promise<string> {
  const root = path.resolve(config.cwd, args.cwd || '.');
  assertSandbox(root, config.cwd);
  const files = await fg(args.pattern, {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: args.ignore || ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  });
  return JSON.stringify({
    files: files.map((file) => path.relative(config.cwd, path.join(root, file))),
  });
}
