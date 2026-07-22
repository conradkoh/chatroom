import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ProcessManager } from './process-manager.js';
import { runCommandOrThrow } from './run-command.js';
import { loadSavedRuntimeConfig } from './saved-runtime-config.js';
import type { ConvexBackupStatus } from '../shared/protocol.js';

import {
  backupDir,
  CONVEX_BACKEND_CWD,
  CONVEX_ENV_FILE,
  deleteBackupFile,
  formatBackupFilename,
  listBackupEntries,
} from './convex-backup.js';

type Events = { update: [ConvexBackupStatus] };

export class ConvexBackupService extends EventEmitter<Events> {
  private status: ConvexBackupStatus = { status: 'idle', backups: [], error: null };

  constructor(private readonly repoRoot: string) {
    super();
    this.refreshList();
  }

  getStatus(): ConvexBackupStatus {
    return this.status;
  }

  private publish(status: ConvexBackupStatus): void {
    this.status = status;
    this.emit('update', status);
  }

  refreshList(): void {
    try {
      const backups = listBackupEntries(this.repoRoot);
      this.publish({ status: 'idle', backups, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({ ...this.status, status: 'error', error: message });
    }
  }

  async create(): Promise<void> {
    const envFile = join(this.repoRoot, CONVEX_BACKEND_CWD, CONVEX_ENV_FILE);
    if (!existsSync(envFile)) {
      this.publish({
        ...this.status,
        status: 'error',
        error: `Convex env file not found at ${CONVEX_BACKEND_CWD}/${CONVEX_ENV_FILE}. Start the stack once before creating a backup.`,
      });
      return;
    }

    this.publish({ ...this.status, status: 'creating', error: null });
    try {
      mkdirSync(backupDir(this.repoRoot), { recursive: true });
      const filename = formatBackupFilename();
      const relPath = join('.convex/user-backups', filename);
      await runCommandOrThrow(join(this.repoRoot, CONVEX_BACKEND_CWD), 'pnpm', [
        'exec',
        'convex',
        'export',
        '--env-file',
        CONVEX_ENV_FILE,
        '--deployment',
        'local',
        '--include-file-storage',
        '--path',
        relPath,
      ]);
      this.refreshList();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({ ...this.status, status: 'error', error: message });
    }
  }

  async restore(backupId: string, manager: ProcessManager): Promise<void> {
    const envFile = join(this.repoRoot, CONVEX_BACKEND_CWD, CONVEX_ENV_FILE);
    if (!existsSync(envFile)) {
      this.publish({
        ...this.status,
        status: 'error',
        error: `Convex env file not found at ${CONVEX_BACKEND_CWD}/${CONVEX_ENV_FILE}. Start the stack once before restoring.`,
      });
      return;
    }

    this.publish({ ...this.status, status: 'restoring', error: null });
    try {
      const relImportPath = join('.convex/user-backups', backupId);
      await manager.stopStack();
      await runCommandOrThrow(join(this.repoRoot, CONVEX_BACKEND_CWD), 'pnpm', [
        'exec',
        'convex',
        'import',
        '--env-file',
        CONVEX_ENV_FILE,
        '--deployment',
        'local',
        '--replace-all',
        '-y',
        relImportPath,
      ]);
      const config = manager.runtimeConfig ?? loadSavedRuntimeConfig(this.repoRoot);
      if (config) {
        await manager.startStack(config);
      }
      this.refreshList();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({ ...this.status, status: 'error', error: message });
    }
  }

  async delete(backupId: string): Promise<void> {
    this.publish({ ...this.status, status: 'deleting', error: null });
    try {
      deleteBackupFile(this.repoRoot, backupId);
      this.refreshList();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.publish({ ...this.status, status: 'error', error: message });
    }
  }
}
