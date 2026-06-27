import { describe, expect, it } from 'vitest';
import { TaskManager } from '../../src/modes/background.js';

describe('TaskManager', () => {
  it('starts tasks in running state', () => {
    const manager = new TaskManager();

    const id = manager.startTask('Summarize the repository');
    const task = manager.getTask(id);

    expect(task).toBeDefined();
    expect(task).toMatchObject({
      id,
      goal: 'Summarize the repository',
      status: 'running',
    });
    expect(task?.startedAt).toBeTypeOf('string');
  });

  it('completes and fails tasks', () => {
    const manager = new TaskManager();
    const doneId = manager.startTask('Write release notes');
    const failedId = manager.startTask('Refactor prompts');

    manager.completeTask(doneId, 'Release notes ready.');
    manager.failTask(failedId, 'Cancelled by user.');

    expect(manager.getTask(doneId)).toMatchObject({
      status: 'done',
      result: 'Release notes ready.',
    });
    expect(manager.getTask(doneId)?.completedAt).toBeTypeOf('string');

    expect(manager.getTask(failedId)).toMatchObject({
      status: 'failed',
      error: 'Cancelled by user.',
    });
    expect(manager.getTask(failedId)?.completedAt).toBeTypeOf('string');
  });

  it('lists and formats tasks', () => {
    const manager = new TaskManager();
    const firstId = manager.startTask('First task');
    const secondId = manager.startTask('Second task');

    manager.completeTask(firstId, 'Done.');

    expect(manager.listTasks()).toHaveLength(2);
    expect(manager.formatTaskList()).toContain('Background tasks');
    expect(manager.formatTaskList()).toContain('First task');
    expect(manager.formatTaskList()).toContain('Second task');
    expect(manager.formatTaskResult(secondId)).toContain('status: running');
    expect(manager.formatTaskResult(firstId)).toContain('result: Done.');
  });
});
