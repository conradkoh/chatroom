import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../../api.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

type RawCommand = NonNullable<
  FunctionReturnType<typeof api.chatroomWorkspaceAgentCommandsInbox.claimNext>
>;
export type ClaimedWorkspaceAgentCommand = Omit<RawCommand, '_id'> & {
  _id: string;
};
export type WorkspaceAgentCommandSubscriberHandle = { stop(): Promise<void> };

export function startChatroomWorkspaceAgentCommandsSubscriber(
  deps: ConvexSubscriberDeps,
  onClaimed: (command: ClaimedWorkspaceAgentCommand) => Promise<void>
): WorkspaceAgentCommandSubscriberHandle {
  let draining = false;
  let queued = false;
  let stopped = false;
  const args = { sessionId: deps.sessionId, machineId: deps.machineId };
  const drain = async () => {
    if (stopped || draining) {
      queued = true;
      return;
    }
    draining = true;
    try {
      do {
        queued = false;
        let claimed;
        while (
          (claimed = await deps.wsClient.mutation(
            api.chatroomWorkspaceAgentCommandsInbox.claimNext,
            args
          ))
        )
          await onClaimed(claimed as ClaimedWorkspaceAgentCommand);
      } while (queued && !stopped);
    } finally {
      draining = false;
    }
  };
  const unsub = deps.wsClient.onUpdate(
    api.chatroomWorkspaceAgentCommandsInbox.watchNext,
    args,
    (commandId) => {
      if (commandId) void drain();
    },
    (err) => console.warn(`[daemon] workspace-agent-command watch error: ${String(err)}`)
  );
  void drain();
  return {
    async stop() {
      stopped = true;
      unsub();
    },
  };
}
