'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useEffect, useState } from 'react';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';
import { describeAgentOperation, type ReportFeedback } from '../utils/describeAgentOperation';

export interface DashboardAgentBulkActionsOptions {
  chatroomId: string;
  /** The dashboard strip's report. Every action calls it with `null` first. */
  report: ReportFeedback;
  /** Agent panel agents. The restart latch releases once they report running (see effect). */
  agents: readonly { role: string; state: string }[];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The restart latch releases once the remote agents are no longer starting and one is running.
 * Moved from ChatroomDashboard.tsx; the `user` role is not a remote agent.
 */
function shouldReleaseRestartLatch(agents: readonly { role: string; state: string }[]): boolean {
  const remoteAgents = agents.filter((a) => a.role.toLowerCase() !== 'user');
  const anyStarting = remoteAgents.some((a) => a.state === 'starting');
  const allRunning = remoteAgents.length > 0 && remoteAgents.every((a) => a.state === 'running');
  return allRunning || (!anyStarting && remoteAgents.some((a) => a.state === 'running'));
}

/**
 * Dashboard stop-all and restart-all. Each action clears the feedback slot, then reports its outcome:
 * pure success reports `null`, partial failure and thrown errors report an error draft.
 */
export function useDashboardAgentBulkActions({
  chatroomId,
  report,
  agents,
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

  // Moved verbatim from ChatroomDashboard.tsx. The latch is driven by agent state on purpose, so the
  // "state synced from props" lint rules are silenced for this pre-existing behaviour only.
  /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-chain-state-updates */
  useEffect(() => {
    if (!isRestartingAllAgents) return;
    if (shouldReleaseRestartLatch(agents)) setIsRestartingAllAgents(false);
  }, [isRestartingAllAgents, agents]);

  return { isRequestingStop, isRestartingAllAgents, stopAllRemoteAgents, restartAllRemoteAgents };
}
