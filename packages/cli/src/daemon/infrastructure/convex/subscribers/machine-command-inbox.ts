import { MACHINE_COMMAND_LEASE_RENEWAL_INTERVAL_MS } from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';

import { api, type Id } from '../../../../api.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

type RawClaimedMachineCommand = NonNullable<
  FunctionReturnType<typeof api.daemon.machineCommandInbox.claimNext>
>;
export type ClaimedMachineCommand = Omit<RawClaimedMachineCommand, 'commandId'> & {
  commandId: string;
};
export type SubscriberHandle = { stop(): Promise<void> };

const MACHINE_COMMAND_KEY = '__machine__';

/** Agent lifecycle commands serialize per chatroom/role/workspace, not workspace-wide. */
// fallow-ignore-next-line complexity
function getMachineCommandConcurrencyKey(command: ClaimedMachineCommand): string {
  if (
    'chatroomId' in command &&
    typeof command.chatroomId === 'string' &&
    'role' in command &&
    typeof command.role === 'string' &&
    'workingDir' in command &&
    typeof command.workingDir === 'string'
  ) {
    return `agent:${command.chatroomId}:${command.role.toLowerCase()}:${command.workingDir}`;
  }
  return MACHINE_COMMAND_KEY;
}

/** Watches for lightweight nudges and dispatches claimed commands by agent. */
export function startMachineCommandInboxSubscriber(
  deps: ConvexSubscriberDeps,
  onClaimed: (claimed: ClaimedMachineCommand) => Promise<void>
): SubscriberHandle {
  let draining = false;
  let queued = false;
  let stopped = false;
  let machineTail = Promise.resolve();
  const workspaceTails = new Map<string, Promise<void>>();

  const enqueueClaimed = (claimed: ClaimedMachineCommand): void => {
    const key = getMachineCommandConcurrencyKey(claimed);
    const previousMachine = machineTail;
    const previousWorkspace = workspaceTails.get(key) ?? Promise.resolve();
    const previous =
      key === MACHINE_COMMAND_KEY
        ? Promise.all([previousMachine, ...workspaceTails.values()])
        : Promise.all([previousMachine, previousWorkspace]);
    const renewTimer = setInterval(() => {
      void deps.wsClient
        .mutation(api.daemon.machineCommandInbox.renewClaim, {
          sessionId: deps.sessionId,
          commandId: claimed.commandId as Id<'chatroom_machineCommandInbox'>,
        })
        .catch(() => undefined);
    }, MACHINE_COMMAND_LEASE_RENEWAL_INTERVAL_MS);
    const task = previous
      .then(async () => {
        try {
          await onClaimed(claimed);
          await deps.wsClient.mutation(api.daemon.machineCommandInbox.acknowledge, {
            sessionId: deps.sessionId,
            commandId: claimed.commandId as Id<'chatroom_machineCommandInbox'>,
          });
        } finally {
          clearInterval(renewTimer);
        }
      })
      .catch((error) => {
        clearInterval(renewTimer);
        console.warn(`[daemon] machine command ${claimed.commandId} failed: ${String(error)}`);
      });

    if (key === MACHINE_COMMAND_KEY) machineTail = task;
    else workspaceTails.set(key, task);

    void task.finally(() => {
      if (key !== MACHINE_COMMAND_KEY && workspaceTails.get(key) === task) {
        workspaceTails.delete(key);
      }
    });
  };

  const args = { sessionId: deps.sessionId, machineId: deps.machineId };
  // fallow-ignore-next-line complexity
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
          enqueueClaimed(claimed);
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
