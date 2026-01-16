'use client';

import { usePaginatedQuery } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';

/**
 * A hook that combines session-based authentication with paginated queries.
 * Automatically injects the sessionId into query args.
 *
 * @param query - A paginated query reference that expects sessionId in its args
 * @param args - The query arguments excluding sessionId and paginationOpts
 * @param options - Pagination options including initialNumItems
 */
export function useSessionPaginatedQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  options: { initialNumItems: number }
) {
  const [sessionId] = useSessionId();

  const result = usePaginatedQuery(query, sessionId ? { ...args, sessionId } : 'skip', options);

  return result;
}
