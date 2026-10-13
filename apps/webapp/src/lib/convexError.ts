import { ConvexError } from 'convex/values';

/** A ConvexError string payload, when it is not empty. */
function stringPayloadMessage(data: unknown): string | null {
  return typeof data === 'string' && data.length > 0 ? data : null;
}

/** The message of a ConvexError object payload, when it has one. */
function objectPayloadMessage(data: unknown): string | null {
  const message = (data as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : null;
}

/** A ConvexError's string payload, then its object message, then the fallback. */
function getConvexErrorMessage(error: { data: unknown }, fallback: string): string {
  return stringPayloadMessage(error.data) ?? objectPayloadMessage(error.data) ?? fallback;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    return getConvexErrorMessage(error, fallback);
  }
  return error instanceof Error ? error.message : fallback;
}
