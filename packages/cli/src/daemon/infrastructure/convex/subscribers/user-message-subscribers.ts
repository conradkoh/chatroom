import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';
import {
  startUserMessageSubscriber,
} from './user-message.js';
import type { SubscriberHandle } from './workspace-list.js';

/** Start user-message intake for one chatroom or all machine-orchestrated chatrooms. */
export function startUserMessageSubscribers(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void | Promise<void>
): SubscriberHandle {
  if (deps.chatroomId) {
    return startUserMessageSubscriber(deps, onEvent);
  }

  const active = new Map<string, SubscriberHandle>();
  let stopped = false;
  let unsubscribe = () => {};

  const syncSubscribers = (chatroomIds: string[] | null | undefined) => {
    if (stopped || chatroomIds == null) return;
    if (!Array.isArray(chatroomIds)) return;
    const next = new Set(chatroomIds);
    for (const [chatroomId, handle] of active) {
      if (!next.has(chatroomId)) {
        void handle.stop();
        active.delete(chatroomId);
      }
    }
    for (const chatroomId of next) {
      if (active.has(chatroomId)) continue;
      active.set(
        chatroomId,
        startUserMessageSubscriber({ ...deps, chatroomId }, onEvent)
      );
    }
  };

  const subscribe = () => {
    unsubscribe = deps.wsClient.onUpdate(
      api.machines.listOrchestratedChatroomIdsForMachine,
      { sessionId: deps.sessionId, machineId: deps.machineId },
      (chatroomIds: string[] | null) => {
        syncSubscribers(chatroomIds);
      },
      (error: unknown) =>
        console.warn(`[daemon] user-message chatroom-list error: ${String(error)}`)
    );
  };

  subscribe();

  return {
    async stop() {
      stopped = true;
      unsubscribe();
      await Promise.all([...active.values()].map((handle) => handle.stop()));
      active.clear();
    },
  };
}
