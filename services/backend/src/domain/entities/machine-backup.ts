/**
 * Machine backup request entity: validators, statuses and pure transition rules.
 *
 * A row is either an `inventory` snapshot of the machine's local backup files (transient,
 * like the repository ledger) or a `download` request that owns at most one `_storage` blob.
 * Terminal rows are immutable; the cron deletes them after their retention window.
 */
import {
  BACKUP_ERROR_CODES,
  BACKUP_UPLOAD_CONTENT_TYPE,
} from '@workspace/shared/domain/machine-backup';
import { v, type Infer } from 'convex/values';

export const machineBackupStatusValidator = v.union(
  v.literal('requested'),
  v.literal('preparing'),
  v.literal('ready'),
  v.literal('downloading'),
  v.literal('downloaded'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('expired'),
  v.literal('cancelled')
);

export const backupErrorCodeValidator = v.union(
  ...BACKUP_ERROR_CODES.map((code) => v.literal(code))
);

export const inventoryEntryValidator = v.object({
  filename: v.string(),
  sizeBytes: v.number(),
  modifiedAt: v.number(),
});

export type BackupKind = 'inventory' | 'download';
export type BackupStatus = Infer<typeof machineBackupStatusValidator>;

/** Statuses in which a download still owns (or is about to own) a stored copy. */
export const ACTIVE_DOWNLOAD_STATUSES = ['requested', 'preparing', 'ready', 'downloading'] as const;

/** Statuses that no longer change; the cron eventually deletes the row. */
export const TERMINAL_STATUSES = [
  'downloaded',
  'completed',
  'failed',
  'expired',
  'cancelled',
] as const;

/** A reported blob may be treated as an orphan for this long after creation. */
export const ORPHAN_BLOB_WINDOW_MS = 2 * 60 * 60_000;

/** True when the status is terminal and therefore immutable. */
export function isTerminal(status: BackupStatus): boolean {
  return (TERMINAL_STATUSES as readonly BackupStatus[]).includes(status);
}

/** True when a download in this status still owns, or is about to own, a stored copy. */
export function isActiveDownloadStatus(status: BackupStatus): boolean {
  return (ACTIVE_DOWNLOAD_STATUSES as readonly BackupStatus[]).includes(status);
}

/** Allowed download transitions. A self-transition is an upload retry or a download re-mint. */
const DOWNLOAD_TRANSITIONS: Record<BackupStatus, readonly BackupStatus[]> = {
  requested: ['preparing', 'failed', 'cancelled'],
  preparing: ['preparing', 'ready', 'failed', 'cancelled'],
  ready: ['downloading', 'expired', 'cancelled'],
  downloading: ['downloading', 'downloaded', 'expired', 'cancelled'],
  downloaded: [],
  completed: [],
  failed: [],
  expired: [],
  cancelled: [],
};

/** Allowed inventory transitions. The snapshot has no stored copy and never downloads. */
const INVENTORY_TRANSITIONS: Record<BackupStatus, readonly BackupStatus[]> = {
  requested: ['completed', 'failed'],
  preparing: [],
  ready: [],
  downloading: [],
  downloaded: [],
  completed: [],
  failed: [],
  expired: [],
  cancelled: [],
};

/** True when a row of `kind` may move from `from` to `to`. */
export function canTransition(kind: BackupKind, from: BackupStatus, to: BackupStatus): boolean {
  const table = kind === 'download' ? DOWNLOAD_TRANSITIONS : INVENTORY_TRANSITIONS;
  return table[from].includes(to);
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Normalizes a SHA-256 digest (hex, or base64 of 32 bytes) to lowercase hex.
 * Returns null when the value is neither form, so callers reject it instead of comparing noise.
 */
export function toHexSha256(digest: string): string | null {
  if (HEX_SHA256.test(digest)) return digest.toLowerCase();
  if (!BASE64_SHA256.test(digest)) return null;
  return Array.from(atob(digest), (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/**
 * A reported blob may be deleted as an orphan only when Convex recorded our content type and
 * it is recent. This bounds what a mistaken or malicious caller can delete.
 */
export function isOrphanBackupBlob(
  meta: { contentType?: string; _creationTime: number },
  now: number
): boolean {
  return (
    meta.contentType === BACKUP_UPLOAD_CONTENT_TYPE &&
    now - meta._creationTime <= ORPHAN_BLOB_WINDOW_MS
  );
}
