import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSchedule,
  listScheduled,
  parseInterval,
  resetScheduledTasks,
  scheduleOnce,
  scheduleRecurring,
  setScheduleRunner,
} from '../../src/commands/schedule-cmd.js';

describe('schedule-cmd', () => {
  const runner = vi.fn<(_: string) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    resetScheduledTasks();
    runner.mockReset();
    setScheduleRunner(runner);
  });

  afterEach(() => {
    setScheduleRunner(null);
    resetScheduledTasks();
    vi.useRealTimers();
  });

  it('parses composite intervals', () => {
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval('5m')).toBe(5 * 60_000);
    expect(parseInterval('1h')).toBe(60 * 60_000);
    expect(parseInterval('2h30m')).toBe(2 * 60 * 60_000 + 30 * 60_000);
  });

  it('fires recurring prompts and keeps the schedule active', async () => {
    const task = scheduleRecurring('30s', 'Run tests');

    expect(listScheduled()).toHaveLength(1);
    expect(listScheduled()[0]).toMatchObject({
      id: task.id,
      type: 'recurring',
      interval: 30_000,
      prompt: 'Run tests',
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(runner).toHaveBeenCalledWith('Run tests');
    expect(listScheduled()).toHaveLength(1);
    expect(listScheduled()[0]?.nextRun.getTime()).toBeGreaterThan(Date.now());
  });

  it('fires one-shot prompts once and removes them', async () => {
    const task = scheduleOnce('45s', 'Check build');

    expect(listScheduled().map((entry) => entry.id)).toContain(task.id);

    await vi.advanceTimersByTimeAsync(45_000);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith('Check build');
    expect(listScheduled()).toEqual([]);
  });

  it('cancels a scheduled task', async () => {
    const task = scheduleRecurring('10s', 'Do not run');

    expect(cancelSchedule(task.id)).toBe(true);
    expect(cancelSchedule(task.id)).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(runner).not.toHaveBeenCalled();
    expect(listScheduled()).toEqual([]);
  });
});
