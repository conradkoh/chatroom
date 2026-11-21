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

  // Each branch is a distinct, tested outcome (cooldown, request, failure) and fallow reads no
  // coverage data for this file, so its CRAP score is pessimistic.
  // fallow-ignore-next-line complexity
  return useCallback(async () => {
    report(null);
    const now = Date.now();
    if (now - lastRefreshRef.current < cooldownMs) {
      report({ tone: 'info', message: 'Refresh already in progress — please wait a moment' });
      return;
    }
    lastRefreshRef.current = now;
    try {
      if (machineId && workingDir) {
        await requestGitRefresh({ machineId, workingDir });
      }
    } catch (err) {
      report({ tone: 'error', message: 'Failed to refresh workspace state' });
      console.error('Refresh workspace state failed:', err);
    }
  }, [cooldownMs, machineId, workingDir, report, requestGitRefresh]);
}
