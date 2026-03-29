/**
 * Shared error message extraction for CLI commands.
 *
 * ConvexErrors carry structured data (code, message) that is more helpful
 * than the generic "[Request ID: xxx] Server Error" .message property.
 */

import { ConvexError } from 'convex/values';

/**
 * Extracts a user-friendly error message from a Convex error or generic Error.
 * Prefers structured ConvexError data over the generic Error.message.
 *
 * Handles all ConvexError data types:
 * - String data: `throw new ConvexError('some message')` → returns the string directly
 * - Object data with message: `throw new ConvexError({ code: 'X', message: 'Y' })` → returns Y
 * - Object data with code only: `throw new ConvexError({ code: 'X' })` → returns X
 * - Other types: falls back to String(error.data)
 * - Non-ConvexError: returns (error as Error).message or String(error) for non-Error values
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    if (typeof error.data === 'string') {
      return error.data;
    }
    if (error.data !== null && typeof error.data === 'object') {
      const data = error.data as { code?: string; message?: string };
      return data.message ?? data.code ?? String(error.data);
    }
    return String(error.data);
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error === null || error === undefined) {
    return String(error);
  }
  return String(error);
}
