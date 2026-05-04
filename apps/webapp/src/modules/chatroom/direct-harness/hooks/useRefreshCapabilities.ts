/**
 * Hook for requesting a capability refresh for a workspace.
 *
 * Wraps the `directHarness.capabilities.requestRefresh` mutation and
 * provides `{refresh, isRefreshing}` state to consumers.
 *
 * Refresh failures are surfaced via an optional `onError` callback
 * but do NOT block callers — the form remains usable with cached defaults.
 */
'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

export interface UseRefreshCapabilitiesOptions {
  /** Called when the refresh mutation throws. Does NOT block the form. */
  onError?: (err: Error) => void;
}

export interface UseRefreshCapabilitiesResult {
  /** Trigger a capability refresh for the given workspace. */
  refresh: (workspaceId: Id<'chatroom_workspaces'>) => void;
  /** True while the mutation is in flight. */
  isRefreshing: boolean;
}

export function useRefreshCapabilities(
  options?: UseRefreshCapabilitiesOptions
): UseRefreshCapabilitiesResult {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestRefresh = useSessionMutation(api.chatroom.directHarness.capabilities.requestRefresh);

  const refresh = useCallback(
    (workspaceId: Id<'chatroom_workspaces'>) => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      void requestRefresh({ workspaceId })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          options?.onError?.(error);
        })
        .finally(() => {
          setIsRefreshing(false);
        });
    },
    [isRefreshing, requestRefresh, options]
  );

  return { refresh, isRefreshing };
}
