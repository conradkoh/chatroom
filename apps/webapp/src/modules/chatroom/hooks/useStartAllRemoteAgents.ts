'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';
import { useStartAgentsWithFavorites } from '../features/machine-config/hooks/useStartAgentsWithFavorites';

export interface UseStartAllRemoteAgentsOptions {
  chatroomId: string;
}

/**
 * Start-all for one chatroom, with two entry points:
 * - `startAllFromPalette`: the command palette. Starts every agent with its last configuration; never prompts.
 * - `requestStartAllFromAgentsSidebar`: the agents-sidebar play control. Runs the favourites check first; may prompt.
 * Both end in the same start + toast body (`runStartAll`).
 */
export function useStartAllRemoteAgents({ chatroomId }: UseStartAllRemoteAgentsOptions) {
  const { startAgents } = useChatroomAgentOperations();
  const [isStartingAll, setIsStartingAll] = useState(false);

  // appliedCount > 0 only when the favourites check saved favourites before this start.
  // One toast per outcome (failed / requested / skipped) is the whole feedback contract.
  const runStartAll = useCallback(
    // fallow-ignore-next-line complexity
    async ({ appliedCount }: { appliedCount: number }) => {
      setIsStartingAll(true);
      try {
        const result = await startAgents(chatroomId as Id<'chatroom_rooms'>);
        if (result.failed.length > 0) {
          toast.error(`Failed to start ${result.failed.length} agent(s)`);
        } else if (result.requested.length > 0) {
          const requestedText = `Start requested for ${result.requested.length} agent(s)`;
          toast.success(
            appliedCount > 0
              ? `Applied favourites to ${appliedCount} agent(s). ${requestedText}.`
              : requestedText
          );
        } else if (result.skipped.length > 0) {
          toast.error('No saved agent configuration is available.');
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to start agents');
      } finally {
        setIsStartingAll(false);
      }
    },
    [chatroomId, startAgents]
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
