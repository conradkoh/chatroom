'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useState } from 'react';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';
import { describeAgentOperation, type ReportFeedback } from '../utils/describeAgentOperation';

export interface DashboardAgentBulkActionsOptions {
  chatroomId: string;
  /** The dashboard strip's report. Every action calls it with `null` first. */
  report: ReportFeedback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Dashboard stop-all and restart-all. Each action clears the feedback slot, then reports its outcome:
 * pure success reports `null`, partial failure and thrown errors report an error draft.
 *
 * `isRestartingAllAgents` is a latch: `restartAllRemoteAgents` sets it and never clears it, so the
 * caller owns the release and clears it once the agents report running.
 */
export function useDashboardAgentBulkActions({
  chatroomId,
  report,
}: DashboardAgentBulkActionsOptions) {
  const { stopAgents, restartAgents } = useChatroomAgentOperations();
  const [isRequestingStop, setIsRequestingStop] = useState(false);
  const [isRestartingAllAgents, setIsRestartingAllAgents] = useState(false);

  const stopAllRemoteAgents = useCallback(async () => {
    report(null);
    setIsRequestingStop(true);
    try {
      report(describeAgentOperation(await stopAgents(chatroomId as Id<'chatroom_rooms'>), 'stop'));
    } catch (error) {
      report({ tone: 'error', message: errorMessage(error, 'Failed to stop agents') });
    } finally {
      setIsRequestingStop(false);
    }
  }, [chatroomId, report, stopAgents]);

  const restartAllRemoteAgents = useCallback(async () => {
    report(null);
    setIsRestartingAllAgents(true);
    try {
      report(
        describeAgentOperation(await restartAgents(chatroomId as Id<'chatroom_rooms'>), 'restart')
      );
    } catch (error) {
      report({ tone: 'error', message: errorMessage(error, 'Failed to restart agents') });
    }
    // No finally: the latch stays set until agents report running. Pre-existing behaviour, unchanged.
  }, [chatroomId, report, restartAgents]);

  return {
    isRequestingStop,
    isRestartingAllAgents,
    setIsRestartingAllAgents,
    stopAllRemoteAgents,
    restartAllRemoteAgents,
  };
}
