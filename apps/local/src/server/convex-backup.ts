import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ConvexBackupEntry } from '../shared/protocol.js';

export const USER_BACKUPS_DIR = 'services/backend/.convex/user-backups';
export const CONVEX_ENV_FILE = '.convex/local-dev.env';
export const CONVEX_BACKEND_CWD = 'services/backend';

export function backupDir(repoRoot: string): string {
  return join(repoRoot, USER_BACKUPS_DIR);
}

export function formatBackupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `backup-${ts}.zip`;
}

export function listBackupEntries(repoRoot: string): ConvexBackupEntry[] {
  const dir = backupDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  return readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((filename) => {
      const stat = statSync(join(dir, filename));
      return { id: filename, filename, createdAt: stat.mtimeMs, sizeBytes: stat.size };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function resolveBackupPath(repoRoot: string, backupId: string): string {
  if (!/^backup-\d{8}-\d{6}\.zip$/.test(backupId)) {
    throw new Error('Invalid backup id');
  }
  return join(backupDir(repoRoot), backupId);
}

export function deleteBackupFile(repoRoot: string, backupId: string): void {
  unlinkSync(resolveBackupPath(repoRoot, backupId));
}
