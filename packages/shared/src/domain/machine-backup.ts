/**
 * Machine backup constants shared by the backend, the daemon and the webapp.
 *
 * A "machine backup" is the local Convex backup archive (`convex export --include-file-storage`)
 * produced by the local stack. The daemon lists and uploads it; the backend stores it as an
 * ephemeral download copy and deletes it once the user confirms receipt.
 */

/** Directory (relative to the repository root) where the local stack stores user backups. */
export const USER_BACKUPS_DIR_RELATIVE = 'services/backend/.convex/user-backups';

/** The only filename shape the local stack produces, and the only shape we serve. */
export const BACKUP_FILENAME_PATTERN = /^backup-\d{8}-\d{6}\.zip$/;

/** True when `name` is a backup archive produced by the local stack. */
export function isBackupFilename(name: string): boolean {
  return BACKUP_FILENAME_PATTERN.test(name);
}

/** Upper bound for one uploaded backup: 256 MiB. */
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024;

/** Content type the daemon attaches to an uploaded backup blob. */
export const BACKUP_UPLOAD_CONTENT_TYPE = 'application/x-chatroom-machine-backup';

/** Maximum inventory entries stored for one snapshot; extras set `truncated`. */
export const BACKUP_INVENTORY_MAX_ENTRIES = 200;

/** Upload URL mints allowed per request before the request fails. */
export const BACKUP_UPLOAD_MAX_ATTEMPTS = 3;

/**
 * Reasons the daemon may report a backup request as failed.
 *
 * Kept as a readonly tuple so the backend builds its error-code validator from the same list.
 */
export const BACKUP_ERROR_CODES = [
  'daemon_timeout',
  'file_missing',
  'not_a_file',
  'too_large',
  'file_changed',
  'upload_failed',
  'size_mismatch',
  'checksum_mismatch',
  'read_failed',
  'stack_not_found',
] as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];
