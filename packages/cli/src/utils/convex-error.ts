/**
 * Shared error message extraction for CLI commands.
 *
 * ConvexErrors carry structured data (code, message, fields) that is more helpful
 * than the generic "[Request ID: xxx] Server Error" .message property.
 */

import { FILE_TREE_SYNC_DISABLED_CODE } from '@workspace/backend/convex/workspaceFileTree/access.js';
import { ConvexError, type Value } from 'convex/values';

const SERVER_ERROR_HINT =
  'This is a generic server error — likely a backend arg-validator rejection or a CLI/backend version mismatch.' +
  ' Verify the CLI and backend are on the same commit (run `pnpm install` and check `git log -1 origin/master`).';

/**
 * Extracts a user-friendly error message from a Convex error or generic Error.
 * Prefers structured ConvexError data over the generic Error.message.
 *
 * Handles all ConvexError data types:
 * - String data: `throw new ConvexError('some message')` → returns the string directly
 * - Object data with message: `throw new ConvexError({ code: 'X', message: 'Y' })` → returns Y
 * - Object data with code only: `throw new ConvexError({ code: 'X' })` → returns X
 * - Object data with fields: appends offending fields to the message
 * - Other types: falls back to String(error.data)
 * - Non-ConvexError with "Server Error" message: appends diagnostic hint
 * - Regular Error: returns error.message
 * - Non-Error values: returns String(value)
 */
function formatConvexErrorObject(data: {
  code?: string | undefined;
  message?: string | undefined;
  fields?: string[] | undefined;
}): string {
  const base = data.message ?? data.code ?? JSON.stringify(data);
  if (Array.isArray(data.fields) && data.fields.length > 0) {
    return `${base}\n  offending fields: ${data.fields.join(', ')}`;
  }
  return base;
}

function formatConvexErrorData(error: ConvexError<Value>): string {
  if (typeof error.data === 'string') return error.data;

  if (error.data !== null && typeof error.data === 'object') {
    return formatConvexErrorObject(
      error.data as {
        code?: string | undefined;
        message?: string | undefined;
        fields?: string[] | undefined;
      }
    );
  }
  return String(error.data);
}

function formatServerError(error: Error): string {
  if (error.message.includes('Server Error')) {
    return `${error.message}\n  hint: ${SERVER_ERROR_HINT}`;
  }
  return error.message;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) return formatConvexErrorData(error as ConvexError<Value>);
  if (error instanceof Error) return formatServerError(error);
  return String(error);
}

/** Returns the structured application code carried by a ConvexError object. */
// fallow-ignore-next-line unused-export complexity
export function getConvexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;

  const data = (error as ConvexError<Value>).data;
  if (data !== null && typeof data === 'object' && 'code' in data) {
    const code = (data as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Identifies the terminal backend response that disables local file-tree sync. */
// fallow-ignore-next-line unused-export
export function isFileTreeSyncDisabledError(error: unknown): boolean {
  return getConvexErrorCode(error) === FILE_TREE_SYNC_DISABLED_CODE;
}
