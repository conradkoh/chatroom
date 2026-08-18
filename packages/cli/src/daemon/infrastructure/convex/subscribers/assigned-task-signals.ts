import { Effect } from 'effect';

import { runIncrementalSubscribeLive } from '../../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
  ASSIGNED_TASK_SIGNAL_FEED_LIMIT,
  assignedTaskSignalsFeedDef,
  assignedTaskSignalsSubscribeTarget,
} from '../../../../infrastructure/incremental-sync/feeds/assigned-task-signals.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps, SubscriberHandle } from '../subscriber-deps.js';

export function startAssignedTaskSignalsSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let stopped = false;

  const startPromise = Effect.runPromise(
    runIncrementalSubscribeLive({
      wsClient: deps.wsClient,
      def: assignedTaskSignalsFeedDef,
      target: assignedTaskSignalsSubscribeTarget,
      args: { sessionId: deps.sessionId, machineId: deps.machineId },
      buffer: ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
      subscribe: { limit: ASSIGNED_TASK_SIGNAL_FEED_LIMIT },
      onItem: ({ item, ack }) =>
        Effect.sync(() => {
          if (stopped) return;
          ack();
          onEvent({
            type: 'assigned-task.signal',
            taskId: item.taskId,
            role: item.role,
            // The task-monitor can merge this incremental row locally without
            // rehydrating the full machine snapshot subscription.
            signal: item,
          });
        }),
      onError: (err) => {
        console.warn(`[daemon] assigned-task-signals subscriber error: ${String(err)}`);
      },
    })
  );

  let feedHandle: Awaited<typeof startPromise> | undefined;
  void startPromise.then((handle) => {
    feedHandle = handle;
  });

  return {
    async stop() {
      stopped = true;
      const handle = feedHandle ?? (await startPromise);
      await Effect.runPromise(handle.stop());
    },
  };
}
