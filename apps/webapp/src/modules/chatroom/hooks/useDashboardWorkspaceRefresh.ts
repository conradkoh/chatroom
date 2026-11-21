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
  /** Minimum time between requests that were sent. A call inside this window reports info and sends nothing. */
  cooldownMs: number;
}

/** A workspace identity with both parts known, so a refresh request can be addressed to it. */
interface RefreshTarget {
  machineId: string;
  workingDir: string;
}

/** The refresh target, or `null` when either part of the workspace identity is missing. */
function getRefreshTarget(
  machineId: string | undefined,
  workingDir: string | undefined
): RefreshTarget | null {
  if (!machineId || !workingDir) return null;
  return { machineId, workingDir };
}

/**
 * True when a click at `now` must not send: a request is in flight, or a request was sent
 * within the cooldown window. `lastStartedAt` is `null` when none was sent or the last one failed.
 */
function isRefreshBlocked(
  { inFlight, lastStartedAt }: { inFlight: boolean; lastStartedAt: number | null },
  now: number,
  cooldownMs: number
): boolean {
  if (inFlight) return true;
  return lastStartedAt !== null && now - lastStartedAt < cooldownMs;
}

/**
 * Dashboard manual workspace-state refresh. Each call clears the strip, then:
 * - no workspace (machine or working dir missing): nothing, and no cooldown is started;
 * - a request is already in flight, or one was sent within the cooldown window: info notice, no request;
 * - otherwise the request is sent and the cooldown starts at dispatch time;
 *   - request throws: the cooldown is cleared so the user can retry, error notice, and the error is logged.
 */
export function useDashboardWorkspaceRefresh({
  machineId,
  workingDir,
  requestGitRefresh,
  report,
  cooldownMs,
}: DashboardWorkspaceRefreshOptions): () => Promise<void> {
  /** Dispatch time of the last request sent. `null` = none sent yet, or the last one failed. */
  const lastStartedAtRef = useRef<number | null>(null);
  /** True while a request is awaiting its response. */
  const inFlightRef = useRef(false);

  return useCallback(async () => {
    report(null);
    const target = getRefreshTarget(machineId, workingDir);
    if (!target) return;

    const now = Date.now();
    if (
      isRefreshBlocked(
        { inFlight: inFlightRef.current, lastStartedAt: lastStartedAtRef.current },
        now,
        cooldownMs
      )
    ) {
      report({ tone: 'info', message: 'Refresh already in progress — please wait a moment' });
      return;
    }

    lastStartedAtRef.current = now;
    inFlightRef.current = true;
    try {
      await requestGitRefresh(target);
    } catch (err) {
      lastStartedAtRef.current = null;
      report({ tone: 'error', message: 'Failed to refresh workspace state' });
      console.error('Refresh workspace state failed:', err);
    } finally {
      inFlightRef.current = false;
    }
  }, [cooldownMs, machineId, workingDir, report, requestGitRefresh]);
}
