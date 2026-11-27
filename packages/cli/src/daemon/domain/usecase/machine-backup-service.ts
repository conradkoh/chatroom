/**
 * Machine backup service: serves `daemon.reportMachineBackups` (inventory) and
 * `daemon.uploadMachineBackup` (one archive to a Convex storage blob).
 *
 * Guarantees: each method starts a background job and returns at once; the same request id never
 * runs twice; a job never rejects; every failure ends in a report; the directory is never created;
 * symlinks and non-files are never read; the upload URL is checked before any byte is sent.
 */

import { join } from 'node:path';

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';
import {
  BACKUP_INVENTORY_MAX_ENTRIES,
  BACKUP_MAX_BYTES,
  BACKUP_UPLOAD_MAX_ATTEMPTS,
  isBackupFilename,
  type BackupErrorCode,
} from '@workspace/shared/domain/machine-backup';

import { getErrorMessage } from '../../../utils/convex-error.js';

type BackupRequestId = Id<'chatroom_machineBackupRequests'>;

export interface FileStat {
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}
export interface DirFile extends FileStat {
  name: string;
}
export interface BackupInventoryEntry {
  filename: string;
  sizeBytes: number;
  modifiedAt: number;
}

export type InventoryReport =
  | {
      requestId: BackupRequestId;
      status: 'completed';
      stackFound: boolean;
      inventoryDir?: string;
      backups: BackupInventoryEntry[];
      totalCount: number;
      totalBytes: number;
      newestAt?: number;
      truncated: boolean;
    }
  | { requestId: BackupRequestId; status: 'failed'; errorMessage: string };

export type CreateUploadUrlResult = { ok: true; uploadUrl: string } | { ok: false; reason: string };

export interface UploadedReport {
  requestId: BackupRequestId;
  storageId: string;
  sizeBytes: number;
  sha256: string;
  stable: boolean;
}

export interface FailedReport {
  requestId: BackupRequestId;
  errorCode: BackupErrorCode;
  errorMessage?: string;
}

export interface MachineBackupPorts {
  /** Backup directory, or null when no local stack is found. Must never create the directory. */
  resolveBackupDir: () => string | null;
  /** Entries of `dir`. Rejects with ENOENT when the directory does not exist. */
  listDir: (dir: string) => Promise<DirFile[]>;
  /** lstat of one path: symlinks are not followed. Rejects with ENOENT when missing. */
  statFile: (path: string) => Promise<FileStat>;
  /** Throws when the upload URL is not allowed for the configured backend. */
  assertUploadUrl: (uploadUrl: string) => void;
  /** Streams `path` to `uploadUrl`; resolves with the storage id and the lowercase hex SHA-256 of the bytes sent. */
  uploadFile: (args: {
    path: string;
    uploadUrl: string;
    sizeBytes: number;
  }) => Promise<{ storageId: string; sha256: string }>;
  reportInventory: (report: InventoryReport) => Promise<unknown>;
  createUploadUrl: (args: {
    requestId: BackupRequestId;
    sizeBytes: number;
  }) => Promise<CreateUploadUrlResult>;
  reportUploaded: (report: UploadedReport) => Promise<unknown>;
  reportFailed: (report: FailedReport) => Promise<unknown>;
}

export interface MachineBackupService {
  serveInventory: (args: { requestId: BackupRequestId }) => 'started' | 'duplicate';
  serveUpload: (args: { requestId: BackupRequestId; filename: string }) => 'started' | 'duplicate';
}

/** Wait before each report retry. One initial attempt plus one retry per entry. */
const REPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function warn(message: string): void {
  console.warn(`[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] ⚠️  ${message}`);
}

/** Retries a report on the fixed schedule, then logs. Never rejects. */
async function reportWithRetry(label: string, report: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await report();
      return;
    } catch (error) {
      const delayMs = REPORT_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        warn(`Machine backup ${label} report failed after retries: ${getErrorMessage(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** A missing directory is an empty inventory, never an error, and never created. */
async function listBackupFiles(ports: MachineBackupPorts, dir: string): Promise<DirFile[]> {
  try {
    return await ports.listDir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function runInventory(ports: MachineBackupPorts, requestId: BackupRequestId): Promise<void> {
  try {
    const dir = ports.resolveBackupDir();
    if (dir === null) {
      await reportWithRetry('inventory', () =>
        ports.reportInventory({
          requestId,
          status: 'completed',
          stackFound: false,
          backups: [],
          totalCount: 0,
          totalBytes: 0,
          truncated: false,
        })
      );
      return;
    }
    const files = (await listBackupFiles(ports, dir))
      .filter((f) => f.isFile && !f.isSymlink && isBackupFilename(f.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
    const newest = files[0];
    await reportWithRetry('inventory', () =>
      ports.reportInventory({
        requestId,
        status: 'completed',
        stackFound: true,
        inventoryDir: dir,
        backups: files
          .slice(0, BACKUP_INVENTORY_MAX_ENTRIES)
          .map((f) => ({ filename: f.name, sizeBytes: f.size, modifiedAt: f.mtimeMs })),
        totalCount: files.length,
        totalBytes: files.reduce((sum, f) => sum + f.size, 0),
        ...(newest ? { newestAt: newest.mtimeMs } : {}),
        truncated: files.length > BACKUP_INVENTORY_MAX_ENTRIES,
      })
    );
  } catch (error) {
    await reportWithRetry('inventory', () =>
      ports.reportInventory({ requestId, status: 'failed', errorMessage: getErrorMessage(error) })
    );
  }
}

async function statOrNull(ports: MachineBackupPorts, path: string): Promise<FileStat | null> {
  try {
    return await ports.statFile(path);
  } catch {
    return null;
  }
}

interface UploadSource {
  path: string;
  first: FileStat;
}

/** Reports one upload failure on the retry schedule. Never rejects. */
function reportUploadFailure(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  errorCode: BackupErrorCode,
  errorMessage: string
): Promise<void> {
  return reportWithRetry('upload failure', () =>
    ports.reportFailed({ requestId, errorCode, errorMessage })
  );
}

/** Resolves the archive path. Returns null after reporting that the request cannot be served. */
async function resolveUploadPath(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  filename: string
): Promise<string | null> {
  if (!isBackupFilename(filename)) {
    await reportUploadFailure(ports, requestId, 'file_missing', 'Not a backup archive name');
    return null;
  }
  const dir = ports.resolveBackupDir();
  if (dir === null) {
    await reportUploadFailure(
      ports,
      requestId,
      'stack_not_found',
      'No local stack was found on this machine'
    );
    return null;
  }
  return join(dir, filename);
}

/** The gate an upload source must pass, or null when it is a regular file within the size cap. */
function uploadGate(first: FileStat): { errorCode: BackupErrorCode; errorMessage: string } | null {
  if (!first.isFile || first.isSymlink) {
    return {
      errorCode: 'not_a_file',
      errorMessage: 'Backup is not a regular file',
    };
  }
  if (first.size > BACKUP_MAX_BYTES) {
    return {
      errorCode: 'too_large',
      errorMessage: 'Backup is larger than the 256 MiB limit',
    };
  }
  return null;
}

/** Stats the archive and applies the file-type and size gates. Returns null after reporting. */
async function statUploadSource(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  path: string
): Promise<UploadSource | null> {
  let first: FileStat;
  try {
    first = await ports.statFile(path);
  } catch (error) {
    await reportUploadFailure(
      ports,
      requestId,
      isNotFound(error) ? 'file_missing' : 'read_failed',
      getErrorMessage(error)
    );
    return null;
  }
  const rejected = uploadGate(first);
  if (rejected) {
    await reportUploadFailure(ports, requestId, rejected.errorCode, rejected.errorMessage);
    return null;
  }
  return { path, first };
}

/** Resolves and gates the source file. Returns null when a failure report was already sent. */
async function resolveUploadSource(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  filename: string
): Promise<UploadSource | null> {
  const path = await resolveUploadPath(ports, requestId, filename);
  if (path === null) return null;
  return statUploadSource(ports, requestId, path);
}

/**
 * One upload attempt: mint, check the origin, stream, re-stat and report.
 * Returns normally when the backend refused the row (the row is already decided).
 */
async function uploadOneAttempt(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  source: UploadSource
): Promise<void> {
  const minted = await ports.createUploadUrl({ requestId, sizeBytes: source.first.size });
  if (!minted.ok) return;

  ports.assertUploadUrl(minted.uploadUrl);
  const { storageId, sha256 } = await ports.uploadFile({
    path: source.path,
    uploadUrl: minted.uploadUrl,
    sizeBytes: source.first.size,
  });

  const second = await statOrNull(ports, source.path);
  const stable =
    second !== null && second.size === source.first.size && second.mtimeMs === source.first.mtimeMs;
  await reportWithRetry('upload', () =>
    ports.reportUploaded({ requestId, storageId, sizeBytes: source.first.size, sha256, stable })
  );
}

type UploadOutcome = { kind: 'done' } | { kind: 'failed'; error: unknown };

/** Runs attempts until one succeeds or the cap is reached. A thrown step counts as one attempt. */
async function uploadWithRetries(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  source: UploadSource
): Promise<UploadOutcome> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BACKUP_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await uploadOneAttempt(ports, requestId, source);
      return { kind: 'done' };
    } catch (error) {
      lastError = error;
    }
  }
  return { kind: 'failed', error: lastError };
}

/**
 * Uploads one archive. Attempts are counted only when a URL was minted and the upload was
 * started; `createUploadUrl` returning `ok: false` means the backend already decided the row.
 */
async function runUpload(
  ports: MachineBackupPorts,
  requestId: BackupRequestId,
  filename: string
): Promise<void> {
  const source = await resolveUploadSource(ports, requestId, filename);
  if (source === null) return;

  const outcome = await uploadWithRetries(ports, requestId, source);
  if (outcome.kind === 'done') return;
  await reportUploadFailure(
    ports,
    requestId,
    'upload_failed',
    `Upload failed after ${BACKUP_UPLOAD_MAX_ATTEMPTS} attempts: ${getErrorMessage(outcome.error)}`
  );
}

export function createMachineBackupService(ports: MachineBackupPorts): MachineBackupService {
  const inFlight = new Set<string>();
  const start = (requestId: string, job: () => Promise<void>): 'started' | 'duplicate' => {
    if (inFlight.has(requestId)) return 'duplicate';
    inFlight.add(requestId);
    void job()
      .catch((error: unknown) => warn(`Machine backup job failed: ${getErrorMessage(error)}`))
      .finally(() => inFlight.delete(requestId));
    return 'started';
  };
  return {
    serveInventory: ({ requestId }) => start(requestId, () => runInventory(ports, requestId)),
    serveUpload: ({ requestId, filename }) =>
      start(requestId, () => runUpload(ports, requestId, filename)),
  };
}
