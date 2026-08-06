import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingMessage {
  runId: string;
}

interface PendingBatch {
  messages?: PendingMessage[];
}

export function startAgenticQueryPromptSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let processing = false;
  const emittedThisDrain = new Set<string>();

  // fallow-ignore-next-line complexity
  const drain = (batch: PendingBatch): void => {
    if (!batch.messages?.length) return;
    const runIds = new Set(batch.messages.map((m) => m.runId));
    for (const sessionId of runIds) {
      if (emittedThisDrain.has(sessionId)) continue;
      emittedThisDrain.add(sessionId);
      onEvent({ type: 'agentic-query.prompt', sessionId });
    }
  };

  const unsub = deps.wsClient.onUpdate(
    api.daemon.agenticQuery.messages.pendingForMachine,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    (batch: PendingBatch | null) => {
      if (!batch) return;
      if (processing) return;
      processing = true;
      try {
        drain(batch);
      } finally {
        processing = false;
        emittedThisDrain.clear();
      }
    },
    (err: unknown) => {
      console.warn(
        `[v2] agentic-query-prompt subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
