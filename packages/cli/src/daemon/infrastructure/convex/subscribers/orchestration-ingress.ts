// fallow-ignore-file code-duplication
import { Effect } from 'effect';

import { runIncrementalSubscribeLive } from '../../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  ORCHESTRATION_INGRESS_FEED_BUFFER,
  ORCHESTRATION_INGRESS_FEED_LIMIT,
  orchestrationIngressFeedDef,
  orchestrationIngressSubscribeTarget,
} from '../../../../infrastructure/incremental-sync/feeds/orchestration-ingress.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

/**
 * P9 orchestration ingress subscriber. Webapp writes ephemeral ingress rows;
 * the hosting daemon pulls and executes user messages locally.
 */
export function startOrchestrationIngressSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let stopped = false;

  const startPromise = Effect.runPromise(
    runIncrementalSubscribeLive({
      wsClient: deps.wsClient,
      def: orchestrationIngressFeedDef,
      target: orchestrationIngressSubscribeTarget,
      args: { sessionId: deps.sessionId, machineId: deps.machineId },
      buffer: ORCHESTRATION_INGRESS_FEED_BUFFER,
      subscribe: { limit: ORCHESTRATION_INGRESS_FEED_LIMIT },
      onItem: ({ item, ack }) =>
        Effect.sync(() => {
          if (stopped) return;
          ack();
          onEvent({
            type: 'orchestration.ingress',
            ingressId: item.ingressId,
            revisionKey: item.revisionKey,
            chatroomId: item.chatroomId,
            content: item.content,
            targetRole: item.targetRole,
            attachedTaskIds: item.attachedTaskIds,
            attachedBacklogItemIds: item.attachedBacklogItemIds,
            attachedMessageIds: item.attachedMessageIds,
            attachedSnippets: item.attachedSnippets,
            sourcePlatform: item.sourcePlatform,
            scheduledPromptId: item.scheduledPromptId,
            plannerEnhancerEnabled: item.plannerEnhancerEnabled,
          });
        }),
      onError: (err) => {
        console.warn(`[daemon] orchestration-ingress subscriber error: ${String(err)}`);
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
