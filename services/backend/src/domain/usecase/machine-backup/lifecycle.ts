/**
 * Machine backup lifecycle — the only place that computes `expiresAt`.
 *
 * Each function takes the current row and `now`, checks the transition, and returns the
 * patch plus whether the stored blob must be deleted. Callers apply the patch; nothing here
 * touches Convex. A transition that the state machine forbids is a programming error and
 * throws a plain `Error` (mutations check status first, so it is never reached in practice).
 */
import type { BackupErrorCode } from '@workspace/shared/domain/machine-backup';

import {
  MACHINE_BACKUP_INVENTORY_TTL_MS,
  MACHINE_BACKUP_PREPARE_TIMEOUT_MS,
  MACHINE_BACKUP_READY_TTL_MS,
  MACHINE_BACKUP_TERMINAL_RETENTION_MS,
  MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
} from '../../../../config/reliability';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import {
  canTransition,
  isTerminal,
  type BackupKind,
  type BackupStatus,
} from '../../entities/machine-backup';

export type BackupRow = Doc<'chatroom_machineBackupRequests'>;
/**
 * A partial row update. `| undefined` is explicit so a terminal transition can clear `storageId`
 * under `exactOptionalPropertyTypes` (Convex removes a field set to undefined).
 */
export type BackupPatch = {
  [K in keyof Omit<BackupRow, '_id' | '_creationTime'>]?: BackupRow[K] | undefined;
};

export interface LifecycleOutcome {
  patch: BackupPatch;
  /** True when the caller must delete `row.storageId` before applying the patch. */
  deleteBlob: boolean;
}

/** Max stored daemon error text. */
const ERROR_MESSAGE_MAX_LENGTH = 500;

/** Transition guard shared by every function below. */
function assertTransition(kind: BackupKind, from: BackupStatus, to: BackupStatus): void {
  if (!canTransition(kind, from, to)) {
    throw new Error(`Illegal machine backup transition: ${kind} ${from} → ${to}`);
  }
}

/** Cuts daemon error text to the stored cap. */
function capErrorMessage(message: string | undefined): string | undefined {
  if (message === undefined || message.length <= ERROR_MESSAGE_MAX_LENGTH) return message;
  return message.slice(0, ERROR_MESSAGE_MAX_LENGTH);
}

/**
 * Expiry for a freshly inserted request. The daemon picks the command up within the routine
 * command delivery window; a request past `expiresAt` is failed or expired by the cron.
 */
export function requestedExpiresAt(createdAt: number): number {
  return createdAt + MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS;
}

/** requested | preparing → preparing. A repeated call is an upload retry and counts a new attempt. */
export function preparingPatch(
  row: BackupRow,
  input: { now: number; sizeBytes: number; uploadAttempts: number }
): LifecycleOutcome {
  assertTransition('download', row.status, 'preparing');
  return {
    patch: {
      status: 'preparing',
      preparingAt: input.now,
      sizeBytes: input.sizeBytes,
      uploadAttempts: input.uploadAttempts,
      expiresAt: input.now + MACHINE_BACKUP_PREPARE_TIMEOUT_MS,
      updatedAt: input.now,
    },
    deleteBlob: false,
  };
}

/** preparing → ready. The row now owns the uploaded blob. */
export function readyPatch(
  row: BackupRow,
  input: { now: number; sizeBytes: number; sha256Hex: string; storageId: Id<'_storage'> }
): LifecycleOutcome {
  assertTransition('download', row.status, 'ready');
  return {
    patch: {
      status: 'ready',
      readyAt: input.now,
      expiresAt: input.now + MACHINE_BACKUP_READY_TTL_MS,
      storageId: input.storageId,
      sha256: input.sha256Hex,
      sizeBytes: input.sizeBytes,
      updatedAt: input.now,
    },
    deleteBlob: false,
  };
}

/** ready | downloading → downloading. Re-minting a URL restarts the download window. */
export function downloadStartPatch(row: BackupRow, now: number): LifecycleOutcome {
  assertTransition('download', row.status, 'downloading');
  return {
    patch: {
      status: 'downloading',
      lastDownloadStartedAt: now,
      expiresAt: now + MACHINE_BACKUP_READY_TTL_MS,
      updatedAt: now,
    },
    deleteBlob: false,
  };
}

/** downloading → downloaded. The blob is deleted and the row keeps only its terminal state. */
export function confirmPatch(row: BackupRow, now: number): LifecycleOutcome {
  assertTransition('download', row.status, 'downloaded');
  return {
    patch: {
      status: 'downloaded',
      finishedAt: now,
      expiresAt: now + MACHINE_BACKUP_TERMINAL_RETENTION_MS,
      storageId: undefined,
      updatedAt: now,
    },
    deleteBlob: true,
  };
}

/**
 * requested | preparing → failed. Used for daemon reports, size/checksum rejections, the too-large
 * gate, and the cron's `daemon_timeout`. Any stored copy is cleared.
 */
export function failPatch(
  row: BackupRow,
  input: { now: number; errorCode?: BackupErrorCode; errorMessage?: string }
): LifecycleOutcome {
  assertTransition(row.kind, row.status, 'failed');
  return {
    patch: {
      status: 'failed',
      finishedAt: input.now,
      expiresAt: input.now + MACHINE_BACKUP_TERMINAL_RETENTION_MS,
      errorCode: input.errorCode,
      errorMessage: capErrorMessage(input.errorMessage),
      storageId: undefined,
      updatedAt: input.now,
    },
    deleteBlob: row.storageId !== undefined,
  };
}

/** A non-terminal download → cancelled | expired. Any stored copy is cleared. */
export function terminalPatch(
  row: BackupRow,
  status: 'cancelled' | 'expired',
  now: number
): LifecycleOutcome {
  assertTransition('download', row.status, status);
  return {
    patch: {
      status,
      finishedAt: now,
      expiresAt: now + MACHINE_BACKUP_TERMINAL_RETENTION_MS,
      storageId: undefined,
      updatedAt: now,
    },
    deleteBlob: row.storageId !== undefined,
  };
}

/**
 * Cron outcome for a row past `expiresAt`.
 * A request the daemon never served fails with `daemon_timeout`; a ready or downloading copy
 * expires. Terminal rows throw: the cron deletes them instead of patching.
 */
export function expiryPatch(row: BackupRow, now: number): LifecycleOutcome {
  if (isTerminal(row.status)) {
    throw new Error(`Cannot expire a terminal machine backup row (${row.status})`);
  }
  if (row.status === 'ready' || row.status === 'downloading') {
    return terminalPatch(row, 'expired', now);
  }
  return failPatch(row, { now, errorCode: 'daemon_timeout' });
}

/** requested inventory → completed. The snapshot is transient and stored inline. */
export function inventoryCompletedPatch(
  row: BackupRow,
  input: {
    now: number;
    inventoryDir?: string;
    stackFound?: boolean;
    backups?: BackupRow['backups'];
    totalCount?: number;
    totalBytes?: number;
    newestAt?: number;
    truncated?: boolean;
  }
): LifecycleOutcome {
  assertTransition('inventory', row.status, 'completed');
  return {
    patch: {
      status: 'completed',
      finishedAt: input.now,
      expiresAt: input.now + MACHINE_BACKUP_INVENTORY_TTL_MS,
      inventoryDir: input.inventoryDir,
      stackFound: input.stackFound,
      backups: input.backups,
      totalCount: input.totalCount,
      totalBytes: input.totalBytes,
      newestAt: input.newestAt,
      truncated: input.truncated,
      updatedAt: input.now,
    },
    deleteBlob: false,
  };
}
