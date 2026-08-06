import type { RunningProcess } from './state.js';
import { PENDING_STOP_TTL_MS } from './state.js';

export class ProcessManager {
  private runningProcesses = new Map<string, RunningProcess>();
  private runningProcessesByCommand = new Map<string, string>();
  private pendingStops = new Map<string, number>();

  has(runId: string): boolean {
    return this.runningProcesses.has(runId);
  }

  get(runId: string): RunningProcess | undefined {
    return this.runningProcesses.get(runId);
  }

  getByCommand(commandKey: string): RunningProcess | undefined {
    const runId = this.runningProcessesByCommand.get(commandKey);
    if (runId === undefined) return undefined;
    return this.runningProcesses.get(runId);
  }

  getAll(): [string, RunningProcess][] {
    return [...this.runningProcesses.entries()];
  }

  get size(): number {
    return this.runningProcesses.size;
  }

  register(runId: string, commandKey: string, process: RunningProcess): void {
    this.runningProcesses.set(runId, process);
    this.runningProcessesByCommand.set(commandKey, runId);
  }

  unregister(runId: string, commandKey: string): void {
    this.runningProcesses.delete(runId);
    if (this.runningProcessesByCommand.get(commandKey) === runId) {
      this.runningProcessesByCommand.delete(commandKey);
    }
  }

  markPendingStop(runId: string): void {
    this.pendingStops.set(runId, Date.now());
  }

  hasPendingStop(runId: string): boolean {
    return this.pendingStops.has(runId);
  }

  consumePendingStop(runId: string): boolean {
    const has = this.pendingStops.has(runId);
    if (has) this.pendingStops.delete(runId);
    return has;
  }

  evictStalePendingStops(): void {
    const evictBefore = Date.now() - PENDING_STOP_TTL_MS;
    for (const [runId, ts] of this.pendingStops) {
      if (ts < evictBefore) this.pendingStops.delete(runId);
    }
  }

  clear(): void {
    this.runningProcesses.clear();
    this.runningProcessesByCommand.clear();
    this.pendingStops.clear();
  }

  waitForExit(runId: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const interval = 100;
      let elapsed = 0;
      const timer = setInterval(() => {
        if (!this.runningProcesses.has(runId)) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        elapsed += interval;
        if (elapsed >= ms) {
          clearInterval(timer);
          resolve(false);
        }
      }, interval);
    });
  }
}

export const processManager = new ProcessManager();
