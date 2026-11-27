import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';

export interface TransferFailure {
  code: string;
  message: string;
  /** One line per offending item, e.g. `<chatroomId>: [CODE] message` for EXPORT_ALL_INCOMPLETE. */
  details: string[];
}

const UNKNOWN_FAILURE: TransferFailure = {
  code: 'UNKNOWN',
  message: 'Could not complete the transfer. Try again.',
  details: [],
};

/** Maps any thrown value to a code, message and detail lines. Never throws. */
// fallow-ignore-next-line complexity
export function transferFailureOf(error: unknown): TransferFailure {
  if (error instanceof ChatroomTransferError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  const data = convexErrorData(error);
  if (data !== null && typeof data.code === 'string') {
    return {
      code: data.code,
      message: typeof data.message === 'string' ? data.message : UNKNOWN_FAILURE.message,
      details: [],
    };
  }
  return UNKNOWN_FAILURE;
}

/** The `data` payload of a Convex error, duck-typed (no `instanceof`). */
// fallow-ignore-next-line complexity
function convexErrorData(error: unknown): { code?: unknown; message?: unknown } | null {
  if (typeof error !== 'object' || error === null || !('data' in error)) return null;
  const data = (error as { data: unknown }).data;
  return typeof data === 'object' && data !== null
    ? (data as { code?: unknown; message?: unknown })
    : null;
}
