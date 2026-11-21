'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useState } from 'react';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';
import { useStartAgentsWithFavorites } from '../features/machine-config/hooks/useStartAgentsWithFavorites';
import { describeAgentOperation, type ReportFeedback } from '../utils/describeAgentOperation';

export interface UseStartAllRemoteAgentsOptions {
  chatroomId: string;
  /** Receives the start outcome. Called with `null` first, so the previous feedback clears. */
  onFeedback: ReportFeedback;
}

/**
 * Start-all for one chatroom, with two entry points:
 * - `startAllFromPalette`: the command palette. Starts every agent with its last configuration; never prompts.
 * - `requestStartAllFromAgentsSidebar`: the agents-sidebar play control. Runs the favourites check first; may prompt.
 * Both end in the same start + feedback body (`runStartAll`).
 */
export function useStartAllRemoteAgents({
  chatroomId,
  onFeedback,
}: UseStartAllRemoteAgentsOptions) {
  const { startAgents } = useChatroomAgentOperations();
  const [isStartingAll, setIsStartingAll] = useState(false);

  // appliedCount > 0 only when the favourites check saved favourites before this start.
  const runStartAll = useCallback(
    // fallow-ignore-next-line complexity
    async ({ appliedCount }: { appliedCount: number }) => {
      onFeedback(null);
      setIsStartingAll(true);
      try {
        const result = await startAgents(chatroomId as Id<'chatroom_rooms'>);
        onFeedback(describeAgentOperation(result, 'start', appliedCount));
      } catch (error) {
        onFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Failed to start agents',
        });
      } finally {
        setIsStartingAll(false);
      }
    },
    [chatroomId, onFeedback, startAgents]
  );

  const startFlow = useStartAgentsWithFavorites({ chatroomId, start: runStartAll });

  const startAllFromPalette = useCallback(() => runStartAll({ appliedCount: 0 }), [runStartAll]);

  return {
    startAllFromPalette,
    requestStartAllFromAgentsSidebar: startFlow.requestStart,
    /** True while any start-all is in flight: palette start, or the sidebar check, apply or start. */
    isBusy: isStartingAll || startFlow.isBusy,
    dialogProps: startFlow.dialogProps,
  };
}
