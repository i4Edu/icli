import { describe, expect, it } from 'vitest';
import { TodoList, todoCommand } from '../../src/commands/todo-cmd.js';

describe('TodoList', () => {
  it('supports a full CRUD cycle through todoCommand', () => {
    const todos = new TodoList();

    const added = todoCommand(['add', 'ship', 'slash', 'command'], todos);
    const [item] = todos.list();

    expect(added).toContain('Added');
    expect(item?.text).toBe('ship slash command');

    const prefix = item!.id.slice(0, 8);
    const done = todoCommand(['done', prefix], todos);
    expect(done).toContain('Marked done');
    expect(todos.list()[0]?.done).toBe(true);

    const undone = todoCommand(['undo', prefix], todos);
    expect(undone).toContain('Marked pending');
    expect(todos.list()[0]?.done).toBe(false);

    const removed = todoCommand(['rm', prefix], todos);
    expect(removed).toContain('Removed');
    expect(todos.list()).toEqual([]);

    todos.add('first');
    todos.add('second');
    expect(todoCommand(['clear'], todos)).toContain('Cleared 2 todos.');
    expect(todos.list()).toEqual([]);
  });

  it('matches ids by prefix', () => {
    const todos = TodoList.fromJSON([
      {
        id: 'abc12345-0000-0000-0000-000000000000',
        text: 'alpha',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'def67890-0000-0000-0000-000000000000',
        text: 'beta',
        done: false,
        createdAt: '2024-01-01T00:00:01.000Z',
      },
    ]);

    const output = todoCommand(['done', 'abc123'], todos);

    expect(output).toContain('Marked done');
    expect(todos.list('done')).toHaveLength(1);
    expect(todos.list('done')[0]?.text).toBe('alpha');
  });

  it('filters pending and done items', () => {
    const todos = TodoList.fromJSON([
      {
        id: 'todo-1',
        text: 'pending task',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'todo-2',
        text: 'done task',
        done: true,
        createdAt: '2024-01-01T00:00:01.000Z',
        completedAt: '2024-01-01T00:00:02.000Z',
      },
    ]);

    expect(todos.list('pending').map((item) => item.text)).toEqual(['pending task']);
    expect(todos.list('done').map((item) => item.text)).toEqual(['done task']);
  });

  it('round-trips through serialization', () => {
    const todos = new TodoList();
    const item = todos.add('persist me');
    todos.complete(item.id);

    const clone = TodoList.fromJSON(todos.toJSON());

    expect(clone.toJSON()).toEqual(todos.toJSON());
  });

  it('formats todo listings with checkboxes', () => {
    const todos = TodoList.fromJSON([
      {
        id: 'todo-pending',
        text: 'write tests',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'todo-done',
        text: 'implement command',
        done: true,
        createdAt: '2024-01-01T00:00:01.000Z',
        completedAt: '2024-01-01T00:00:02.000Z',
      },
    ]);

    const output = todoCommand([], todos);

    expect(output).toContain('Todos');
    expect(output).toContain('○');
    expect(output).toContain('✓');
    expect(output).toContain('write tests');
    expect(output).toContain('implement command');
  });
});
