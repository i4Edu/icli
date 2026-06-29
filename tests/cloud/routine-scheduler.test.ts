import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloudRoutineStore, type Schedule } from '../../src/cloud/routine-storage.js';
import { CloudRoutineScheduler } from '../../src/cloud/routine-scheduler.js';

describe('CloudRoutineStore', () => {
  let tempDir: string;
  let store: CloudRoutineStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icopilot-test-'));
    process.env.ICOPILOT_CLOUD_ROUTINES_PATH = path.join(tempDir, 'routines.json');
    process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH = path.join(tempDir, 'logs.json');
    store = new CloudRoutineStore();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    delete process.env.ICOPILOT_CLOUD_ROUTINES_PATH;
    delete process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH;
  });

  describe('create', () => {
    it('creates a new routine with daily schedule', () => {
      const routine = store.create(
        'daily-standup',
        { type: 'daily', time: '09:00' },
        'generate standup',
      );

      expect(routine.id).toBeDefined();
      expect(routine.name).toBe('daily-standup');
      expect(routine.prompt).toBe('generate standup');
      expect(routine.schedule.type).toBe('daily');
      expect(routine.enabled).toBe(true);
      expect(routine.createdAt).toBeDefined();
      expect(routine.nextRun).toBeDefined();
    });

    it('creates routines with all schedule types', () => {
      const schedules: Schedule[] = [
        { type: 'once' },
        { type: 'daily', time: '10:00' },
        { type: 'weekly', dayOfWeek: 1, time: '14:00' },
        { type: 'monthly', dayOfMonth: 15, time: '09:00' },
        { type: 'custom', expression: '0 9 * * *' },
      ];

      for (let i = 0; i < schedules.length; i++) {
        const routine = store.create(`routine-${i}`, schedules[i]!, 'test prompt');
        expect(routine.schedule.type).toBe(schedules[i]!.type);
      }
    });

    it('throws error if name is empty', () => {
      expect(() => {
        store.create('', { type: 'daily', time: '09:00' }, 'prompt');
      }).toThrow('routine name is required');
    });

    it('throws error if prompt is empty', () => {
      expect(() => {
        store.create('test', { type: 'daily', time: '09:00' }, '');
      }).toThrow('routine prompt is required');
    });

    it('throws error with invalid schedule', () => {
      expect(() => {
        store.create('test', { type: 'invalid' as never }, 'prompt');
      }).toThrow('invalid schedule configuration');
    });

    it('throws error with daily schedule missing time', () => {
      expect(() => {
        store.create('test', { type: 'daily' }, 'prompt');
      }).toThrow('invalid schedule configuration');
    });
  });

  describe('list', () => {
    it('returns empty list initially', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns created routines sorted by creation time', () => {
      const r1 = store.create('routine-1', { type: 'daily', time: '09:00' }, 'prompt 1');
      const r2 = store.create('routine-2', { type: 'daily', time: '10:00' }, 'prompt 2');

      const list = store.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe(r1.id);
      expect(list[1]!.id).toBe(r2.id);
    });
  });

  describe('get', () => {
    it('retrieves a routine by id', () => {
      const created = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const retrieved = store.get(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns undefined for non-existent id', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates routine properties', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const updated = store.update(routine.id, {
        name: 'updated-name',
        prompt: 'updated prompt',
      });

      expect(updated.name).toBe('updated-name');
      expect(updated.prompt).toBe('updated prompt');
      expect(store.get(routine.id)).toEqual(updated);
    });

    it('updates schedule and recalculates nextRun', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const oldNextRun = routine.nextRun;

      const updated = store.update(routine.id, {
        schedule: { type: 'daily', time: '14:00' },
      });

      expect(updated.schedule.time).toBe('14:00');
      expect(updated.nextRun).not.toBe(oldNextRun);
    });

    it('throws error for non-existent routine', () => {
      expect(() => {
        store.update('non-existent', { name: 'new' });
      }).toThrow('routine with id non-existent not found');
    });

    it('throws error on empty name update', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      expect(() => {
        store.update(routine.id, { name: '' });
      }).toThrow('routine name cannot be empty');
    });
  });

  describe('delete', () => {
    it('deletes a routine', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      expect(store.delete(routine.id)).toBe(true);
      expect(store.get(routine.id)).toBeUndefined();
    });

    it('returns false for non-existent routine', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('updateLastRun', () => {
    it('updates last run timestamp and recalculates next run', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const now = new Date().toISOString();

      store.updateLastRun(routine.id, now);

      const updated = store.get(routine.id);
      expect(updated?.lastRun).toBe(now);
      expect(updated?.nextRun).toBeDefined();
    });
  });

  describe('findDueRoutines', () => {
    it('returns routines with nextRun in the past', () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');

      store.update(routine.id, { nextRun: past });

      const due = store.findDueRoutines();
      expect(due).toHaveLength(1);
      expect(due[0]!.id).toBe(routine.id);
    });

    it('excludes disabled routines', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      store.update(routine.id, { enabled: false });

      const due = store.findDueRoutines();
      expect(due).toHaveLength(0);
    });

    it('excludes routines with future nextRun', () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');

      store.update(routine.id, { nextRun: future });

      const due = store.findDueRoutines();
      expect(due).toHaveLength(0);
    });
  });

  describe('logging', () => {
    it('logs execution with success status', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const log = store.logExecution(routine.id, 'success', 'output', undefined, 1234);

      expect(log.routineId).toBe(routine.id);
      expect(log.status).toBe('success');
      expect(log.output).toBe('output');
      expect(log.duration).toBe(1234);
    });

    it('logs execution with error status', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
      const log = store.logExecution(routine.id, 'error', undefined, 'error message', 0);

      expect(log.status).toBe('error');
      expect(log.error).toBe('error message');
    });

    it('retrieves logs for a routine', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');

      for (let i = 0; i < 3; i++) {
        store.logExecution(routine.id, 'success', undefined, undefined, 100 * (i + 1));
      }

      const logs = store.getLogs(routine.id);
      expect(logs).toHaveLength(3);
      expect(logs[0]!.duration).toBe(300);
    });

    it('respects log limit', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');

      for (let i = 0; i < 30; i++) {
        store.logExecution(routine.id, 'success', undefined, undefined, 100);
      }

      const logs = store.getLogs(routine.id, 10);
      expect(logs).toHaveLength(10);
    });
  });

  describe('persistence', () => {
    it('persists routines to disk and loads them on restart', () => {
      const routine1 = store.create('routine-1', { type: 'daily', time: '09:00' }, 'prompt 1');
      const routine2 = store.create(
        'routine-2',
        { type: 'weekly', dayOfWeek: 1, time: '14:00' },
        'prompt 2',
      );

      const store2 = new CloudRoutineStore();
      const list = store2.list();

      expect(list).toHaveLength(2);
      expect(list[0]!.name).toBe('routine-1');
      expect(list[1]!.name).toBe('routine-2');
    });

    it('persists logs to disk and loads them on restart', () => {
      const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');

      for (let i = 0; i < 3; i++) {
        store.logExecution(routine.id, 'success', undefined, undefined, 100);
      }

      const store2 = new CloudRoutineStore();
      const logs = store2.getLogs(routine.id);

      expect(logs).toHaveLength(3);
    });
  });
});

describe('CloudRoutineScheduler', () => {
  let scheduler: CloudRoutineScheduler;
  let store: CloudRoutineStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icopilot-test-'));
    process.env.ICOPILOT_CLOUD_ROUTINES_PATH = path.join(tempDir, 'routines.json');
    process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH = path.join(tempDir, 'logs.json');

    scheduler = new CloudRoutineScheduler(100);
    store = scheduler.getStore();
  });

  afterEach(() => {
    scheduler.stop();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    delete process.env.ICOPILOT_CLOUD_ROUTINES_PATH;
    delete process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH;
  });

  it('starts and stops without error', () => {
    expect(scheduler.isSchedulerRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isSchedulerRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isSchedulerRunning()).toBe(false);
  });

  it('executes due routines', async () => {
    const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
    store.update(routine.id, { nextRun: new Date(Date.now() - 1000).toISOString() });

    let executed = false;
    scheduler.setExecutor(async () => {
      executed = true;
    });

    await scheduler.executeDue();
    expect(executed).toBe(true);
  });

  it('logs execution success', async () => {
    const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
    store.update(routine.id, { nextRun: new Date(Date.now() - 1000).toISOString() });

    scheduler.setExecutor(async () => {});

    await scheduler.executeDue();

    const logs = store.getLogs(routine.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('success');
  });

  it('logs execution error', async () => {
    const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
    store.update(routine.id, { nextRun: new Date(Date.now() - 1000).toISOString() });

    scheduler.setExecutor(async () => {
      throw new Error('execution failed');
    });

    await scheduler.executeDue();

    const logs = store.getLogs(routine.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('error');
    expect(logs[0]!.error).toBe('execution failed');
  });

  it('updates last run after execution', async () => {
    const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
    store.update(routine.id, { nextRun: new Date(Date.now() - 1000).toISOString() });

    scheduler.setExecutor(async () => {});

    await scheduler.executeDue();

    const updated = store.get(routine.id);
    expect(updated?.lastRun).toBeDefined();
  });

  it('skips disabled routines', async () => {
    const routine = store.create('test', { type: 'daily', time: '09:00' }, 'prompt');
    store.update(routine.id, {
      enabled: false,
      nextRun: new Date(Date.now() - 1000).toISOString(),
    });

    let executed = false;
    scheduler.setExecutor(async () => {
      executed = true;
    });

    await scheduler.executeDue();
    expect(executed).toBe(false);
  });
});

describe('Schedule parsing and calculation', () => {
  let tempDir: string;
  let store: CloudRoutineStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icopilot-test-'));
    process.env.ICOPILOT_CLOUD_ROUTINES_PATH = path.join(tempDir, 'routines.json');
    process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH = path.join(tempDir, 'logs.json');
    store = new CloudRoutineStore();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    delete process.env.ICOPILOT_CLOUD_ROUTINES_PATH;
    delete process.env.ICOPILOT_CLOUD_ROUTINES_LOGS_PATH;
  });

  it('calculates correct next run for daily schedule', () => {
    const routine = store.create('daily', { type: 'daily', time: '09:00' }, 'prompt');
    const nextRun = new Date(routine.nextRun!);

    expect(nextRun.getHours()).toBe(9);
    expect(nextRun.getMinutes()).toBe(0);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
  });

  it('calculates correct next run for weekly schedule', () => {
    const routine = store.create(
      'weekly',
      { type: 'weekly', dayOfWeek: 1, time: '14:00' },
      'prompt',
    );
    const nextRun = new Date(routine.nextRun!);

    expect(nextRun.getDay()).toBe(1);
    expect(nextRun.getHours()).toBe(14);
    expect(nextRun.getMinutes()).toBe(0);
  });

  it('calculates correct next run for monthly schedule', () => {
    const routine = store.create(
      'monthly',
      { type: 'monthly', dayOfMonth: 15, time: '10:00' },
      'prompt',
    );
    const nextRun = new Date(routine.nextRun!);

    expect(nextRun.getDate()).toBe(15);
    expect(nextRun.getHours()).toBe(10);
    expect(nextRun.getMinutes()).toBe(0);
  });
});
