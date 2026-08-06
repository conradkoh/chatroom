import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingCommand {
  _id: string;
}

export function startDirectHarnessCommandSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();
  let processing = false;

  // fallow-ignore-next-line complexity
  const drain = async (): Promise<void> => {
    const pending = (await deps.wsClient.query(
      api.daemon.directHarness.commands.listPendingCommands,
      { sessionId: deps.sessionId, machineId: deps.machineId }
    )) as PendingCommand[] | null;

    if (!pending?.length) return;

    for (const cmd of pending) {
      if (seen.has(cmd._id)) continue;
      seen.add(cmd._id);
      onEvent({ type: 'direct-harness.command', commandId: cmd._id });
    }
  };

  const unsub = deps.wsClient.onUpdate(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    () => {
      if (processing) return;
      processing = true;
      void drain()
        .catch((err) =>
          console.warn(
            `[v2] direct-harness-command drain error: ${err instanceof Error ? err.message : String(err)}`
          )
        )
        .finally(() => {
          processing = false;
        });
    },
    (err: unknown) => {
      console.warn(
        `[v2] direct-harness-command subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
