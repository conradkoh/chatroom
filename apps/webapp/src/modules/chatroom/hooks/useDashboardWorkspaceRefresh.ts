'use client';

import { useCallback, useRef } from 'react';

import type { ReportFeedback } from '../utils/describeAgentOperation';

export interface DashboardWorkspaceRefreshOptions {
  machineId: string | undefined;
  workingDir: string | undefined;
  /** The git-refresh request. Passed in so tests substitute the port, not the module. */
  requestGitRefresh: (args: { machineId: string; workingDir: string }) => Promise<unknown>;
  /** The dashboard strip's report. Every call clears it first. */
  report: ReportFeedback;
  /** Minimum time between requests. A call inside this window reports info and sends nothing. */
  cooldownMs: number;
}

/** True when a request at `now` falls inside the cooldown that started at `lastAt`. */
function isWithinRefreshCooldown(lastAt: number, now: number, cooldownMs: number): boolean {
  return now - lastAt < cooldownMs;
}

/**
 * Sends the refresh request when a workspace is known. A missing workspace is a no-op, as before;
 * a rejection is reported by the caller.
 */
async function requestWorkspaceRefresh({
  machineId,
  workingDir,
  requestGitRefresh,
}: Pick<
  DashboardWorkspaceRefreshOptions,
  'machineId' | 'workingDir' | 'requestGitRefresh'
>): Promise<void> {
  if (!machineId || !workingDir) return;
  await requestGitRefresh({ machineId, workingDir });
}

/**
 * Dashboard manual workspace-state refresh. Each call clears the strip, then:
 * - inside the cooldown window: info notice, no request;
 * - request succeeds (or there is no workspace, as before): nothing;
 * - request throws: error notice, and the error is logged.
 */
export function useDashboardWorkspaceRefresh({
  machineId,
  workingDir,
  requestGitRefresh,
  report,
  cooldownMs,
}: DashboardWorkspaceRefreshOptions): () => Promise<void> {
  const lastRefreshRef = useRef(0);

  return useCallback(async () => {
    report(null);
    const now = Date.now();
    if (isWithinRefreshCooldown(lastRefreshRef.current, now, cooldownMs)) {
      report({ tone: 'info', message: 'Refresh already in progress — please wait a moment' });
      return;
    }
    lastRefreshRef.current = now;
    try {
      await requestWorkspaceRefresh({ machineId, workingDir, requestGitRefresh });
    } catch (err) {
      report({ tone: 'error', message: 'Failed to refresh workspace state' });
      console.error('Refresh workspace state failed:', err);
    }
  }, [cooldownMs, machineId, workingDir, report, requestGitRefresh]);
}
