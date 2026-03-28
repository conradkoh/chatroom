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
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; message?: string };
    return data.message || data.code || error.message;
  }
  return (error as Error).message;
}
