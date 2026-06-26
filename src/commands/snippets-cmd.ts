import { deleteSnippet, expandSnippet, listSnippets, readSnippet, saveSnippet } from '../snippets/store.js';
import { theme } from '../ui/theme.js';

export async function snippetsCommand(rest: string[]): Promise<string> {
  const [subcommandRaw, ...args] = rest;
  const subcommand = (subcommandRaw || 'list').toLowerCase();

  try {
    switch (subcommand) {
      case 'list':
        return listCommand();
      case 'save':
        return saveCommand(args);
      case 'show':
        return showCommand(args);
      case 'delete':
        return deleteCommand(args);
      case 'use':
        return useCommand(args);
      default:
        return theme.warn('usage: /snippets [list|save|show|delete|use]\n');
    }
  } catch (error) {
    return theme.err(`snippets failed: ${(error as Error).message}\n`);
  }
}

function listCommand(): string {
  const snippets = listSnippets();
  if (snippets.length === 0) return theme.dim('No snippets saved.\n');

  const lines = snippets.map((snippet) => {
    const preview = firstLine(snippet.body);
    return `  ${theme.hl(snippet.name)}  ${theme.dim(preview)}`;
  });
  return `${theme.brand('Snippets')}\n${lines.join('\n')}\n`;
}

function saveCommand(args: string[]): string {
  const [name, ...bodyParts] = args;
  const body = bodyParts.join(' ');
  if (!name || !body) return theme.warn('usage: /snippets save <name> <body>\n');

  const snippet = saveSnippet(name, body);
  return theme.ok(`✔ saved snippet ${snippet.name}\n`);
}

function showCommand(args: string[]): string {
  const [name] = args;
  if (!name) return theme.warn('usage: /snippets show <name>\n');

  const snippet = readSnippet(name);
  if (!snippet) return theme.warn(`snippet not found: ${name}\n`);
  return snippet.body.endsWith('\n') ? snippet.body : `${snippet.body}\n`;
}

function deleteCommand(args: string[]): string {
  const [name] = args;
  if (!name) return theme.warn('usage: /snippets delete <name>\n');

  return deleteSnippet(name) ? theme.ok(`✔ deleted snippet ${name}\n`) : theme.warn(`snippet not found: ${name}\n`);
}

function useCommand(args: string[]): string {
  const [name, ...varArgs] = args;
  if (!name) return theme.warn('usage: /snippets use <name> [k=v ...]\n');

  const snippet = readSnippet(name);
  if (!snippet) return theme.warn(`snippet not found: ${name}\n`);

  const expanded = expandSnippet(snippet.body, parseVars(varArgs));
  return expanded.endsWith('\n') ? expanded : `${expanded}\n`;
}

function parseVars(args: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) continue;
    vars[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return vars;
}

function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0] || '(empty)';
}
