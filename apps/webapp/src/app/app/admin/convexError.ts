import { ConvexError } from 'convex/values';

function getConvexErrorMessage(error: { data: unknown }, fallback: string): string {
  const data = error.data as { message?: string } | null;
  if (data && typeof data.message === 'string') {
    return data.message;
  }
  return fallback;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    return getConvexErrorMessage(error, fallback);
  }
  return error instanceof Error ? error.message : fallback;
}
