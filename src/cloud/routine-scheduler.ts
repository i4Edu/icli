import { CloudRoutineStore, type CloudRoutine } from './routine-storage.js';

export type RoutineExecutor = (routine: CloudRoutine) => Promise<void>;

export class CloudRoutineScheduler {
  private store: CloudRoutineStore;
  private executor: RoutineExecutor | null = null;
  private pollingInterval: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(pollingInterval = 60000) {
    this.store = new CloudRoutineStore();
    this.pollingInterval = pollingInterval;
  }

  setExecutor(executor: RoutineExecutor): void {
    this.executor = executor;
  }

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleNextCheck();
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalHandle) {
      clearTimeout(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private scheduleNextCheck(): void {
    if (!this.isRunning) return;

    this.intervalHandle = setTimeout(() => {
      void this.executeDue();
      this.scheduleNextCheck();
    }, this.pollingInterval);
  }

  async executeDue(): Promise<void> {
    if (!this.executor) return;

    const dueRoutines = this.store.findDueRoutines();

    for (const routine of dueRoutines) {
      try {
        const startTime = Date.now();
        await this.executor(routine);
        const duration = Date.now() - startTime;

        this.store.logExecution(routine.id, 'success', undefined, undefined, duration);
        this.store.updateLastRun(routine.id, new Date().toISOString());
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.store.logExecution(routine.id, 'error', undefined, error, 0);
      }
    }
  }

  getStore(): CloudRoutineStore {
    return this.store;
  }

  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}

let schedulerInstance: CloudRoutineScheduler | null = null;

export function getCloudRoutineScheduler(): CloudRoutineScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CloudRoutineScheduler();
  }
  return schedulerInstance;
}
