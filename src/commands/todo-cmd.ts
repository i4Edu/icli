import crypto from 'node:crypto';
import { theme } from '../ui/theme.js';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
}

type TodoFilter = 'all' | 'pending' | 'done';

export class TodoList {
  private items: TodoItem[];

  constructor(items: TodoItem[] = []) {
    this.items = items.map(cloneTodo);
  }

  add(text: string): TodoItem {
    const item: TodoItem = {
      id: crypto.randomUUID(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    return cloneTodo(item);
  }

  complete(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return false;
    item.done = true;
    item.completedAt ??= new Date().toISOString();
    return true;
  }

  uncomplete(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return false;
    item.done = false;
    delete item.completedAt;
    return true;
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  list(filter: TodoFilter = 'all'): TodoItem[] {
    return this.items
      .filter((item) => {
        if (filter === 'pending') return !item.done;
        if (filter === 'done') return item.done;
        return true;
      })
      .map(cloneTodo);
  }

  clear(): number {
    const count = this.items.length;
    this.items = [];
    return count;
  }

  toJSON(): TodoItem[] {
    return this.items.map(cloneTodo);
  }

  static fromJSON(data: unknown): TodoList {
    if (!Array.isArray(data)) return new TodoList();

    const items = data.flatMap((item) => {
      const parsed = parseTodoItem(item);
      return parsed ? [parsed] : [];
    });
    return new TodoList(items);
  }
}

export function todoCommand(args: string[], todos: TodoList): string {
  const [rawSubcommand = 'list', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand === 'list') {
    const filter = parseFilter(rest[0]);
    return filter ? formatTodoList(todos, filter) : usage();
  }

  if (subcommand === 'add') {
    const text = rest.join(' ').trim();
    if (!text) return usage();
    const item = todos.add(text);
    return `${theme.ok('Added')} ${formatMarker(item.done)} ${theme.hl(shortId(item.id))} ${item.text}\n`;
  }

  if (subcommand === 'done' || subcommand === 'undo' || subcommand === 'rm') {
    const prefix = rest[0]?.trim();
    if (!prefix) return usage();

    const match = findByPrefix(todos, prefix);
    if (match.kind === 'missing') {
      return `${theme.warn(`No todo matches "${prefix}".`)}\n`;
    }
    if (match.kind === 'ambiguous') {
      const options = match.items.map((item) => shortId(item.id)).join(', ');
      return `${theme.warn(`Multiple todos match "${prefix}": ${options}`)}\n`;
    }

    const item = match.item;
    if (subcommand === 'done') {
      todos.complete(item.id);
      return `${theme.ok('Marked done')} ${formatMarker(true)} ${theme.hl(shortId(item.id))} ${item.text}\n`;
    }
    if (subcommand === 'undo') {
      todos.uncomplete(item.id);
      return `${theme.ok('Marked pending')} ${formatMarker(false)} ${theme.hl(shortId(item.id))} ${item.text}\n`;
    }

    todos.remove(item.id);
    return `${theme.ok('Removed')} ${theme.hl(shortId(item.id))} ${item.text}\n`;
  }

  if (subcommand === 'clear') {
    const count = todos.clear();
    return `${theme.ok(`Cleared ${count} todo${count === 1 ? '' : 's'}.`)}\n`;
  }

  const filter = parseFilter(rawSubcommand);
  return filter ? formatTodoList(todos, filter) : usage();
}

function formatTodoList(todos: TodoList, filter: TodoFilter = 'all'): string {
  const items = todos.list(filter);
  const suffix = filter === 'all' ? '' : ` ${theme.dim(`(${filter})`)}`;
  const header = `${theme.brand('Todos')}${suffix}`;
  if (items.length === 0) return `${header}\n  ${theme.dim('No todos.')}\n`;

  const lines = items.map(
    (item) => `  ${formatMarker(item.done)} ${theme.hl(shortId(item.id))} ${item.text}`,
  );
  return `${header}\n${lines.join('\n')}\n`;
}

function formatMarker(done: boolean): string {
  return done ? theme.ok('✓') : theme.dim('○');
}

function parseFilter(value: string | undefined): TodoFilter | undefined {
  if (!value) return 'all';
  if (value === 'all' || value === 'pending' || value === 'done') return value;
  return undefined;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function usage(): string {
  return 'Usage: /todo [list [all|pending|done]] | /todo add <text> | /todo done <id-prefix> | /todo undo <id-prefix> | /todo rm <id-prefix> | /todo clear\n';
}

function cloneTodo(item: TodoItem): TodoItem {
  return { ...item };
}

function parseTodoItem(value: unknown): TodoItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    typeof item.text !== 'string' ||
    typeof item.done !== 'boolean' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  const parsed: TodoItem = {
    id: item.id,
    text: item.text,
    done: item.done,
    createdAt: item.createdAt,
  };
  if (typeof item.completedAt === 'string') parsed.completedAt = item.completedAt;
  return parsed;
}

function findByPrefix(
  todos: TodoList,
  prefix: string,
):
  | { kind: 'match'; item: TodoItem }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; items: TodoItem[] } {
  const matches = todos
    .list('all')
    .filter((item) => item.id === prefix || item.id.toLowerCase().startsWith(prefix.toLowerCase()));

  if (matches.length === 0) return { kind: 'missing' };
  if (matches.length > 1) return { kind: 'ambiguous', items: matches };
  return { kind: 'match', item: matches[0]! };
}
