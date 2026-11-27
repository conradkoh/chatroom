/**
 * Every string and pure formatter for the machine Backups panel.
 *
 * Components stay presentational: copy, failure mapping and duration/expiry labels live here so
 * they can be asserted literally without rendering. `modifiedAt` (not `mtimeMs`) is the inventory
 * field the daemon reports.
 */

import { BACKUP_MAX_BYTES } from '@workspace/shared/domain/machine-backup';

import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

export const BACKUP_LIMIT_LABEL = formatFileSize(BACKUP_MAX_BYTES); // "256 MB"

export const BACKUP_SECTION_INTRO =
  "Backups of this machine's local Convex deployment. The list is read from the daemon when you ask; it is a snapshot, not kept in sync.";

export const BACKUP_OFFLINE_COPY =
  "Machine is offline. Start the machine's daemon to check backups.";

export const BACKUP_CONNECTING_COPY = 'Checking connection…';

export const BACKUP_TIMED_OUT_COPY =
  'The daemon did not respond. It may need updating, or it went offline.';

export const BACKUP_NO_STACK_COPY =
  'This machine has no local Convex stack. Backups come from machines running the local Convex stack. A cloud machine uses a hosted deployment, so there is nothing to back up here.';

export const BACKUP_EMPTY_COPY = 'No backups on this machine';

export const BACKUP_EMPTY_HELP =
  'Create one from the Convex Backups panel in the local dashboard on that machine.';

const BACKUP_WARNING_INTRO = 'This file contains the whole local Convex deployment of';
/** The sensitive-action warning shown before a download is prepared. */
export function backupWarningCopy(machineName: string): string {
  return `${BACKUP_WARNING_INTRO} “${machineName}”, including tables that chatroom export never carries — for example bot tokens and session data. Anyone who gets this file can use those credentials. Store it somewhere private.`;
}

/** `filename · size · modified`, with only the parts the caller knows. */
export function backupMetaLine(parts: {
  filename: string;
  sizeBytes: number | null;
  modifiedAt: number | null;
}): string {
  return [
    parts.filename,
    parts.sizeBytes === null ? null : formatFileSize(parts.sizeBytes),
    parts.modifiedAt === null ? null : formatTimestampFull(parts.modifiedAt),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

const INTERRUPTED_COPY = 'The download was interrupted. Try again.';

const DEFAULT_FAILURE = { message: 'Could not download the backup. Try again.', retryable: true };

/** Literal failure copy per daemon, browser, or backend code. */
const BACKUP_FAILURE_COPY: Readonly<Record<string, { message: string; retryable: boolean }>> = {
  daemon_timeout: { message: BACKUP_TIMED_OUT_COPY, retryable: true },
  file_missing: {
    message: 'The backup file is no longer on the machine. Refresh the list.',
    retryable: true,
  },
  not_a_file: { message: 'The daemon could not read the backup file.', retryable: true },
  read_failed: { message: 'The daemon could not read the backup file.', retryable: true },
  too_large: {
    message: `This backup is larger than the ${BACKUP_LIMIT_LABEL} download limit.`,
    retryable: false,
  },
  file_changed: {
    message: 'The backup changed while it was being uploaded. Try again.',
    retryable: true,
  },
  upload_failed: { message: 'The upload to the cloud failed. Try again.', retryable: true },
  size_mismatch: { message: 'The upload to the cloud failed. Try again.', retryable: true },
  checksum_mismatch: { message: 'The upload to the cloud failed. Try again.', retryable: true },
  stack_not_found: { message: 'This machine has no local Convex stack.', retryable: false },
  network: { message: INTERRUPTED_COPY, retryable: true },
  http: { message: INTERRUPTED_COPY, retryable: true },
  aborted: { message: 'The download was stopped.', retryable: false },
  download_size_mismatch: {
    message: 'The downloaded size did not match the backup. Try again.',
    retryable: true,
  },
  BACKUP_NOT_FOUND: {
    message: 'This backup is no longer available. Refresh the list.',
    retryable: true,
  },
  BACKUP_REQUEST_ACTIVE: {
    message: 'Another backup download is already in progress on this machine.',
    retryable: true,
  },
};

/** Literal failure copy for a daemon, browser, or backend code. */
export function backupFailureCopy(code: string): { message: string; retryable: boolean } {
  return BACKUP_FAILURE_COPY[code] ?? DEFAULT_FAILURE;
}

const MILLISECONDS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;

/** Elapsed time as `m:ss`, clamped at zero. */
export function elapsedLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Minutes left before expiry, rounded up with a one-minute floor. */
export function minutesLeftLabel(expiresAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((expiresAt - now) / MILLISECONDS_PER_MINUTE));
  return `${minutes} min`;
}
