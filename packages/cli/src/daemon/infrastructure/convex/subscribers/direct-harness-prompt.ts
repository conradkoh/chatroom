import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingMessage {
  harnessSessionId: string;
}

export function startDirectHarnessPromptSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let processing = false;
  const emittedForDrain = new Set<string>();

  const drain = async (): Promise<void> => {
    const pending = (await deps.wsClient.query(
      api.daemon.directHarness.messages.pendingForMachine,
      { sessionId: deps.sessionId, machineId: deps.machineId }
    )) as { messages: PendingMessage[] } | null;

    if (!pending?.messages.length) return;

    const sessionIds = new Set(pending.messages.map((m) => m.harnessSessionId));
    for (const harnessSessionId of sessionIds) {
      if (emittedForDrain.has(harnessSessionId)) continue;
      emittedForDrain.add(harnessSessionId);
      onEvent({ type: 'direct-harness.prompt', harnessSessionId });
    }
  };

  const unsub = deps.wsClient.onUpdate(
    api.daemon.directHarness.messages.pendingForMachine,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    () => {
      if (processing) return;
      processing = true;
      void drain()
        .catch((err) =>
          console.warn(
            `[daemon] direct-harness-prompt drain error: ${err instanceof Error ? err.message : String(err)}`
          )
        )
        .finally(() => {
          processing = false;
          emittedForDrain.clear();
        });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] direct-harness-prompt subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
