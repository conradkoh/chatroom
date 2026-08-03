'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useRef } from 'react';

export interface HandoffGitRefreshWorkspace {
  machineId: string | null;
  workingDir: string;
  removedAt?: number;
}

type RequestGitRefresh = (args: { machineId: string; workingDir: string }) => Promise<unknown>;

function getActiveWorkspaces(
  workspaces: HandoffGitRefreshWorkspace[]
): HandoffGitRefreshWorkspace[] {
  return workspaces.filter((ws) => ws.machineId && ws.workingDir && !ws.removedAt);
}

function requestRefreshForWorkspaces(
  workspaces: HandoffGitRefreshWorkspace[],
  requestGitRefresh: RequestGitRefresh
): void {
  for (const ws of getActiveWorkspaces(workspaces)) {
    void requestGitRefresh({
      machineId: ws.machineId as string,
      workingDir: ws.workingDir,
    });
  }
}

function shouldRefreshOnHandoff(
  hasUnreadHandoff: boolean,
  prevHandoff: boolean | null,
  isInitial: boolean
): boolean {
  if (isInitial) return hasUnreadHandoff;
  return hasUnreadHandoff && !prevHandoff;
}

/**
 * When the user receives a handoff-to-user in this chatroom, request git refresh
 * for all active workspaces so WorkspaceBottomBar reflects current branch/diff.
 *
 * Complements backend requestSyncOnHandoffToUser (daemon path) with a webapp
 * requestGitRefresh trigger (same as manual refresh button).
 */
export function useHandoffGitRefresh(
  chatroomId: string,
  workspaces: HandoffGitRefreshWorkspace[],
  requestGitRefresh: RequestGitRefresh,
  cooldownMs: number
): void {
  const unreadStatus = useSessionQuery(api.chatrooms.listUnreadStatus);
  const hasUnreadHandoff =
    unreadStatus?.find((u) => u.chatroomId === chatroomId)?.hasUnreadHandoff ?? false;

  const prevHandoffRef = useRef<boolean | null>(null);
  const lastRefreshAtRef = useRef(0);
  const isInitialRef = useRef(true);

  useEffect(() => {
    const prevHandoff = prevHandoffRef.current;
    const isInitial = isInitialRef.current;

    if (isInitial) {
      isInitialRef.current = false;
    }
    prevHandoffRef.current = hasUnreadHandoff;

    if (!shouldRefreshOnHandoff(hasUnreadHandoff, prevHandoff, isInitial)) return;

    const now = Date.now();
    if (now - lastRefreshAtRef.current < cooldownMs) return;
    lastRefreshAtRef.current = now;

    requestRefreshForWorkspaces(workspaces, requestGitRefresh);
  }, [chatroomId, cooldownMs, hasUnreadHandoff, requestGitRefresh, workspaces]);
}
