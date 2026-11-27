import { EXPORT_MAX_FILE_BYTES } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';

import type { TransferFailure } from './transferFailure';

import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';

const UNTITLED_CHATROOM = 'Untitled chatroom';
export const EXPORT_LIMIT_LABEL = formatFileSize(EXPORT_MAX_FILE_BYTES); // "256 MB"
export const MACHINE_LISTING_LABEL = 'Finding chatrooms on this machine…';
export const MACHINE_EMPTY_COPY =
  'No chatrooms to export. Only chatrooms you own with an active workspace on this machine are included.';
export const EXPORT_CANCELLED_COPY = 'Export cancelled. No file was saved.';
const INCOMPLETE_NAME_LIMIT = 5;

export interface OmittedAttachments {
  count: number;
  bytes: number;
}

export interface FailureCopy {
  title: string;
  message: string;
  items?: string[];
  /** True when the UI may offer "Try again". */
  retryable: boolean;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The chatroom's name, or `Untitled chatroom`. */
export function chatroomLabel(name: string | null): string {
  return name !== null && name.trim() !== '' ? name : UNTITLED_CHATROOM;
}

/** Mirrors the CLI: a capped stamp reads as "more than 1000". */
function attachmentCountLabel(count: number): string {
  return count > 1000 ? 'more than 1000' : String(count);
}

/** `3 attachments not included (4.2 MB)`, or null when nothing was omitted. */
function attachmentsNotIncludedItem(omitted: OmittedAttachments): string | null {
  if (omitted.count === 0) return null;
  const noun = omitted.count === 1 ? 'attachment' : 'attachments';
  return `${attachmentCountLabel(omitted.count)} ${noun} not included (${formatFileSize(omitted.bytes)})`;
}

/** The phase label while a machine export is writing; `done` chatrooms have finished. */
export function machineExportingLabel(done: number, total: number): string {
  return `Exporting ${Math.min(done + 1, total)} of ${pluralize(total, 'chatroom')}…`;
}

/** Success for a machine bundle: the file name, then the chatroom count and omissions. */
export function machineExportSuccess(args: {
  fileName: string;
  chatroomCount: number;
  omitted: OmittedAttachments;
}): { message: string; items: string[] } {
  const attachments = attachmentsNotIncludedItem(args.omitted);
  return {
    message: `Saved ${args.fileName}`,
    items: [pluralize(args.chatroomCount, 'chatroom'), ...(attachments ? [attachments] : [])],
  };
}

/** Copy for a failed machine export. `failed` carries the names (never the ids) of the chatrooms that failed. */
// fallow-ignore-next-line complexity
export function machineExportFailure(
  failure: TransferFailure,
  failed: readonly { name: string | null }[],
  total: number
): FailureCopy {
  switch (failure.code) {
    case 'EXPORT_ALL_INCOMPLETE': {
      const names = failed.slice(0, INCOMPLETE_NAME_LIMIT).map((f) => chatroomLabel(f.name));
      const rest = failed.length - names.length;
      const noun = total === 1 ? 'chatroom' : 'chatrooms';
      return {
        title: 'Export incomplete — no file was saved',
        message: `${failed.length} of ${total} ${noun} could not be exported:`,
        items: rest > 0 ? [...names, `and ${rest} more`] : names,
        retryable: true,
      };
    }
    case 'EXPORT_TOO_LARGE':
      return {
        title: 'Export failed',
        message: `The bundle is larger than the ${EXPORT_LIMIT_LABEL} limit and cannot be saved as one file.`,
        retryable: false,
      };
    case 'EXPORT_MACHINE_TOO_LARGE':
      return {
        title: 'Export failed',
        message: 'This machine has too many workspaces to export at once.',
        retryable: false,
      };
    case 'EXPORT_CHATROOM_CHANGED':
      return {
        title: 'Export failed',
        message: 'A chatroom changed while exporting. Try again.',
        retryable: true,
      };
    default:
      return { title: 'Export failed', message: 'Could not export. Try again.', retryable: true };
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const IMPORT_DIALOG_TITLE = 'Import chatrooms';
export const IMPORT_DIALOG_DESCRIPTION =
  'Import chatrooms from an export file made by the CLI or this app. The file is read in your browser and is never uploaded.';
export const IMPORT_NO_CHATROOMS_COPY = 'This file contains no chatrooms.';
export const IMPORT_MACHINE_HELP_COPY =
  "Chatrooms are linked to this machine's folders. It does not need to be online.";
export const IMPORT_KEEP_OPEN_COPY = 'Keep this tab open until it finishes.';
export const IMPORT_ROLLING_BACK_COPY =
  'Rolling back the chatroom being imported. This can take a few seconds.';
export const IMPORT_STOP_CONFIRM_TITLE = 'Stop importing?';
export const IMPORT_NOT_IMPORTABLE_HELP = 'None of the chatrooms in this file can be imported.';
export const IMPORT_ATTACHMENTS_NOTE =
  'Attachments are not included in exports; messages keep their text.';

/** Row status while the entry has not started yet. */
export const IMPORT_ROW_WAITING = 'Waiting';
/** Row status after an entry finished successfully. */
export const IMPORT_ROW_IMPORTED = 'Imported';
/** Row status when the run never reached the entry. */
export const IMPORT_ROW_NOT_STARTED = 'Not started';
/** Row status while the entry in progress is being rolled back. */
export const IMPORT_ROW_ROLLING_BACK = 'Rolling back…';

const IMPORT_NOTHING_CREATED = 'Nothing was created.';
const IMPORT_ROLLED_BACK = 'Rolled back — nothing was kept.';

/** Explains what a file-level refusal means; falls back to the parser's own message. */
// fallow-ignore-next-line complexity
export function importRejectCopy(code: string, message: string, fileSizeBytes?: number): string {
  switch (code) {
    case 'IMPORT_FILE_TOO_LARGE':
      return fileSizeBytes === undefined
        ? `This file is larger than the ${EXPORT_LIMIT_LABEL} limit.`
        : `This file is ${formatFileSize(fileSizeBytes)}. The limit is ${EXPORT_LIMIT_LABEL}.`;
    case 'IMPORT_FILE_UNREADABLE':
      return 'This file is not valid JSON or could not be read.';
    case 'IMPORT_NOT_AN_EXPORT':
      return 'This is not a machine export file. Save one with Export chatrooms on a machine card, or with chatroom export.';
    case 'IMPORT_UNSUPPORTED_VERSION':
      return 'This export uses a format version this app does not support. Re-export it with a matching version.';
    case 'IMPORT_CHECKSUM_MISMATCH':
      return 'The file was changed or damaged after it was exported (checksum mismatch).';
    default:
      return message;
  }
}

/** Result title. `fatal` and `cancelled` both read "Import stopped". */
export function importResultTitle(s: {
  failed: number;
  cancelled: boolean;
  fatal: boolean;
}): string {
  if (s.cancelled || s.fatal) return 'Import stopped';
  if (s.failed > 0) return 'Import finished with errors';
  return 'Import complete';
}

/** `Imported 7 of 10 selected · Failed 1 · Not started 2`; zero segments are omitted except Imported. */
export function importSummaryLine(s: {
  imported: number;
  selected: number;
  failed: number;
  skipped: number;
}): string {
  const parts = [`Imported ${s.imported} of ${s.selected} selected`];
  if (s.failed > 0) parts.push(`Failed ${s.failed}`);
  if (s.skipped > 0) parts.push(`Not started ${s.skipped}`);
  return parts.join(' · ');
}

export function importingTitle(): string {
  return 'Importing chatrooms';
}

/** `Importing… part 3 of 12`; before the first chunk lands it is just `Importing…`. */
export function importingChunkCopy(done: number, total: number): string {
  return total === 0 ? 'Importing…' : `Importing… part ${done} of ${total}`;
}

/** One failed row's status: the code, then the message. */
export function importFailedStatusCopy(code: string, message: string): string {
  return `${code} — ${message}`;
}

/** Why an entry never started: the user stopped the run, or the target refused it. */
export function importNotStartedCopy(reason: 'cancelled' | 'fatal'): string {
  return reason === 'cancelled'
    ? 'Not started (you stopped the import)'
    : 'Not started (the import stopped)';
}

/** The outcome line under a failed row: kept, removed, or left behind. */
export function importFailureNote(failure: {
  rolledBack: boolean;
  orphanChatroomId?: string;
}): string {
  if (failure.orphanChatroomId !== undefined) {
    return `Rollback failed. Chatroom ${failure.orphanChatroomId} may be incomplete.`;
  }
  return failure.rolledBack ? IMPORT_ROLLED_BACK : IMPORT_NOTHING_CREATED;
}

/** `3 attachments not included`, with the CLI's "more than 1000" cap. */
export function omittedAttachmentsCopy(count: number): string {
  return `${attachmentCountLabel(count)} ${count === 1 ? 'attachment' : 'attachments'} not included`;
}
