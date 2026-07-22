import { EventEmitter } from 'node:events';

import type { ProcessManager } from './process-manager.js';
import { checkRepoUpdate, pullAndInstall } from './repo-update.js';
import { loadSavedRuntimeConfig } from './saved-runtime-config.js';
import type { RepoUpdateStatus } from '../shared/protocol.js';

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

type RepoUpdateEvents = {
  update: [RepoUpdateStatus];
};

export class RepoUpdateService extends EventEmitter<RepoUpdateEvents> {
  private readonly repoRoot: string;
  private status: RepoUpdateStatus = {
    status: 'idle',
    localCommit: null,
    remoteCommit: null,
    error: null,
  };
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(repoRoot: string) {
    super();
    this.repoRoot = repoRoot;
  }

  getStatus(): RepoUpdateStatus {
    return this.status;
  }

  startPolling(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
    void this.check();
    this.pollTimer = setInterval(() => void this.check(), intervalMs);
    this.pollTimer.unref();
  }

  stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private publish(status: RepoUpdateStatus): void {
    this.status = status;
    this.emit('update', status);
  }

  async check(): Promise<void> {
    if (this.status.status === 'updating') return;

    this.publish({
      ...this.status,
      status: 'checking',
      error: null,
    });

    try {
      const result = await checkRepoUpdate(this.repoRoot);
      this.publish({
        status: result.updateAvailable ? 'available' : 'up-to-date',
        localCommit: result.localCommit,
        remoteCommit: result.remoteCommit,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({
        status: 'error',
        localCommit: this.status.localCommit,
        remoteCommit: this.status.remoteCommit,
        error: message,
      });
    }
  }

  async apply(manager: ProcessManager): Promise<void> {
    const config = manager.runtimeConfig ?? loadSavedRuntimeConfig(this.repoRoot);
    if (!config) {
      throw new Error('No saved runtime config found. Start the stack once before updating.');
    }

    this.publish({
      ...this.status,
      status: 'updating',
      error: null,
    });

    try {
      await manager.stopStack();
      await pullAndInstall(this.repoRoot);
      await manager.startStack(config);
      await this.check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({
        ...this.status,
        status: 'error',
        error: message,
      });
      throw err;
    }
  }
}
