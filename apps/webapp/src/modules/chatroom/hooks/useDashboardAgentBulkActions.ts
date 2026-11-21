'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useState } from 'react';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';
import { describeAgentOperation, type ReportFeedback } from '../utils/describeAgentOperation';

export interface DashboardAgentBulkActionsOptions {
  chatroomId: string;
  /** The dashboard strip's report. Every action calls it with `null` first. */
  report: ReportFeedback;
  /** True while a remote agent (the user excluded) is in the `starting` state. */
  isAnyRemoteAgentStarting: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** `requesting`: the restart request is in flight. `settled`: it returned, with success or failure. */
type RestartPhase = 'idle' | 'requesting' | 'settled';

/**
 * Dashboard stop-all and restart-all. Each action clears the feedback slot, then reports its outcome:
 * pure success reports `null`, partial failure and thrown errors report an error draft.
 *
 * `isRestartingAllAgents` is the restart latch:
 * - set from the click until the request settles, whatever the outcome;
 * - after it settles, held only while a remote agent is starting, so a second restart is blocked
 *   during startup;
 * - released as soon as no remote agent is starting. Running agents do not hold it, so a restart that
 *   fails while other agents run never keeps Restart disabled.
 */
export function useDashboardAgentBulkActions({
  chatroomId,
  report,
  isAnyRemoteAgentStarting,
}: DashboardAgentBulkActionsOptions) {
  const { stopAgents, restartAgents } = useChatroomAgentOperations();
  const [isRequestingStop, setIsRequestingStop] = useState(false);
  const [restartPhase, setRestartPhase] = useState<RestartPhase>('idle');
  const isRestartingAllAgents =
    restartPhase === 'requesting' || (restartPhase === 'settled' && isAnyRemoteAgentStarting);

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
    setRestartPhase('requesting');
    try {
      report(
        describeAgentOperation(await restartAgents(chatroomId as Id<'chatroom_rooms'>), 'restart')
      );
    } catch (error) {
      report({ tone: 'error', message: errorMessage(error, 'Failed to restart agents') });
    }
    setRestartPhase('settled');
  }, [chatroomId, report, restartAgents]);

  return {
    isRequestingStop,
    isRestartingAllAgents,
    stopAllRemoteAgents,
    restartAllRemoteAgents,
  };
}
