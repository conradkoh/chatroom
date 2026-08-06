import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface CommandEvent {
  _id: string;
}

interface CommandEventsResult {
  events?: CommandEvent[];
}

export function startCommandEventsSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.machines.getCommandEvents,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (result: CommandEventsResult | null) => {
      if (!result?.events?.length) return;
      for (const event of result.events) {
        if (seen.has(event._id)) continue;
        seen.add(event._id);
        onEvent({ type: 'command.received', commandId: event._id });
      }
    },
    (err: unknown) => {
      console.warn(
        `[v2] command-events subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
