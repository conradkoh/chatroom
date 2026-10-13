import { ConvexError } from 'convex/values';

/** The server's message when a ConvexError carries one. */
function convexErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const message = (error.data as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : null;
}

/**
 * Prefers the server's ConvexError message, then a plain Error message, then the fallback. The
 * default is the chatroom-creation wording the wizard has always shown.
 */
export function messageFromError(error: unknown, fallback = 'Failed to create chatroom'): string {
  return convexErrorMessage(error) ?? (error instanceof Error ? error.message : fallback);
}
