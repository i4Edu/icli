import { describe, expect, it } from 'vitest';
import { DependencyScheduler, type TaskNode } from '../../src/adaptive/dependency-scheduler.js';

describe('DependencyScheduler', () => {
  it('schedules tasks into parallel batches and computes the critical path', () => {
    const scheduler = new DependencyScheduler();
    const tasks: TaskNode[] = [
      { id: 'plan', name: 'Plan', dependencies: [], estimatedDuration: 2, status: 'pending' },
      {
        id: 'design',
        name: 'Design',
        dependencies: ['plan'],
        estimatedDuration: 3,
        status: 'pending',
      },
      {
        id: 'tests',
        name: 'Tests',
        dependencies: ['plan'],
        estimatedDuration: 1,
        status: 'pending',
      },
      {
        id: 'release',
        name: 'Release',
        dependencies: ['design', 'tests'],
        estimatedDuration: 4,
        status: 'pending',
      },
    ];

    const graph = scheduler.buildGraph(tasks);
    const schedule = scheduler.schedule(graph);

    expect(schedule.order).toEqual([['plan'], ['tests', 'design'], ['release']]);
    expect(schedule.criticalPath).toEqual(['plan', 'design', 'release']);
    expect(schedule.estimatedDuration).toBe(9);
  });

  it('updates ready tasks as dependencies complete and cascades failures', () => {
    const scheduler = new DependencyScheduler();
    const graph = scheduler.buildGraph([
      { id: 'a', name: 'A', dependencies: [], status: 'pending' },
      { id: 'b', name: 'B', dependencies: ['a'], status: 'pending' },
      { id: 'c', name: 'C', dependencies: ['b'], status: 'pending' },
    ]);

    expect(scheduler.getReady(graph).map((task) => task.id)).toEqual(['a']);
    scheduler.markComplete(graph, 'a');
    expect(scheduler.getReady(graph).map((task) => task.id)).toEqual(['b']);

    scheduler.markFailed(graph, 'b');
    expect(graph.nodes.find((node) => node.id === 'b')?.status).toBe('failed');
    expect(graph.nodes.find((node) => node.id === 'c')?.status).toBe('failed');
  });

  it('detects dependency cycles', () => {
    const scheduler = new DependencyScheduler();
    const graph = scheduler.buildGraph([
      { id: 'a', name: 'A', dependencies: ['c'], status: 'pending' },
      { id: 'b', name: 'B', dependencies: ['a'], status: 'pending' },
      { id: 'c', name: 'C', dependencies: ['b'], status: 'pending' },
    ]);

    const cycles = scheduler.detectCycles(graph);
    expect(cycles[0]).toEqual(['a', 'b', 'c', 'a']);
  });
});
