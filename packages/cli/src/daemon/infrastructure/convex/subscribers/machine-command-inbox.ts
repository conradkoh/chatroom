import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../../api.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

type RawClaimedMachineCommand = NonNullable<
  FunctionReturnType<typeof api.daemon.machineCommandInbox.claimNext>
>;
export type ClaimedMachineCommand = Omit<RawClaimedMachineCommand, 'commandId'> & {
  commandId: string;
};
export type SubscriberHandle = { stop(): Promise<void> };

/** Watches for lightweight nudges and serially claims full machine commands. */
export function startMachineCommandInboxSubscriber(
  deps: ConvexSubscriberDeps,
  onClaimed: (claimed: ClaimedMachineCommand) => Promise<void>
): SubscriberHandle {
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
          (claimed = await deps.wsClient.mutation(api.daemon.machineCommandInbox.claimNext, args))
        )
          await onClaimed(claimed);
      } while (queued && !stopped);
    } finally {
      draining = false;
    }
  };
  const unsub = deps.wsClient.onUpdate(
    api.daemon.machineCommandInbox.watchNext,
    args,
    (result) => {
      if (result?.commandId) void drain();
    },
    (err) => console.warn(`[daemon] machine-command-inbox watch error: ${String(err)}`)
  );
  void drain();
  return {
    async stop() {
      stopped = true;
      unsub();
    },
  };
}
