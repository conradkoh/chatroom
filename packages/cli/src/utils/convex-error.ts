/**
 * Shared error message extraction for CLI commands.
 *
 * ConvexErrors carry structured data (code, message, fields) that is more helpful
 * than the generic "[Request ID: xxx] Server Error" .message property.
 */

import { ConvexError } from 'convex/values';

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
export function getErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    if (typeof error.data === 'string') {
      return error.data;
    }
    if (error.data !== null && typeof error.data === 'object') {
      const data = error.data as {
        code?: string;
        message?: string;
        fields?: string[];
      };
      const base = data.message ?? data.code ?? String(error.data);
      const parts = [base];

      if (Array.isArray(data.fields) && data.fields.length > 0) {
        parts.push(`  offending fields: ${data.fields.join(', ')}`);
      }

      return parts.join('\n');
    }
    return String(error.data);
  }
  if (error instanceof Error) {
    if (error.message.includes('Server Error')) {
      return `${error.message}\n  hint: ${SERVER_ERROR_HINT}`;
    }
    return error.message;
  }
  if (error === null || error === undefined) {
    return String(error);
  }
  return String(error);
}