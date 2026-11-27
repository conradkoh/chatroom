import { EXPORT_MAX_FILE_BYTES } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';

import type { TransferFailure } from './transferFailure';

import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';

const UNTITLED_CHATROOM = 'Untitled chatroom';
const EXPORT_LIMIT_LABEL = formatFileSize(EXPORT_MAX_FILE_BYTES); // "256 MB"
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

function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The chatroom's name, or `Untitled chatroom`. */
function chatroomLabel(name: string | null): string {
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

export function chatroomExportingLabel(name: string | null): string {
  return `Exporting “${chatroomLabel(name)}”…`;
}

/** The phase label while a machine export is writing; `done` chatrooms have finished. */
export function machineExportingLabel(done: number, total: number): string {
  return `Exporting ${Math.min(done + 1, total)} of ${pluralize(total, 'chatroom')}…`;
}

/** Success for one chatroom. The file name is shown verbatim. */
export function chatroomExportSuccess(args: {
  name: string | null;
  fileName: string;
  omitted: OmittedAttachments;
}): { message: string; items?: string[] } {
  const item = attachmentsNotIncludedItem(args.omitted);
  return {
    message: `Exported “${chatroomLabel(args.name)}” to ${args.fileName}.`,
    ...(item ? { items: [item] } : {}),
  };
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

/** Copy for a failed single-chatroom export. */
export function chatroomExportFailure(failure: TransferFailure): FailureCopy {
  switch (failure.code) {
    case 'EXPORT_CHATROOM_CHANGED':
      return {
        title: 'Export failed',
        message: 'This chatroom changed while exporting. Try again.',
        retryable: true,
      };
    case 'EXPORT_TOO_LARGE':
      return {
        title: 'Export failed',
        message: `The export is larger than the ${EXPORT_LIMIT_LABEL} limit and cannot be saved as one file.`,
        retryable: false,
      };
    default:
      return { title: 'Export failed', message: 'Could not export. Try again.', retryable: true };
  }
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
