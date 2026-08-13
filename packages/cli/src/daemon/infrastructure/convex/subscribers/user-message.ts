import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';
import type { SubscriberHandle } from './workspace-list.js';

export function startUserMessageSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void | Promise<void>
): SubscriberHandle {
  if (!deps.chatroomId) return { async stop() {} };
  const chatroomId = deps.chatroomId;
  let cursor = Number(deps.loadUserIntentCursor?.(chatroomId) ?? Date.now());
  let stopped = false;
  let unsubscribe = () => {};
  let processing = Promise.resolve();
  const subscribe = () => {
    unsubscribe = deps.wsClient.onUpdate(
      api.messageList.subscribeNewMessages,
      { sessionId: deps.sessionId, chatroomId: chatroomId as never, afterCreationTime: cursor },
      (
        messages:
          { _id: string; _creationTime: number; senderRole?: string; content?: string }[] | null
      ) => {
        // fallow-ignore-next-line complexity
        processing = processing
          .then(async () => {
            for (const message of messages ?? []) {
              if (message._creationTime <= cursor) continue;
              if (message.senderRole === 'user') {
                await onEvent({
                  type: 'user-message.received',
                  chatroomId,
                  messageId: message._id,
                  content: message.content,
                  senderRole: message.senderRole,
                });
              }
              cursor = message._creationTime;
              deps.saveUserIntentCursor?.(chatroomId, String(cursor));
            }
            if (!stopped && (messages?.length ?? 0) > 0) {
              unsubscribe();
              subscribe();
            }
          })
          .catch((error) =>
            console.warn(`[daemon] user-message processing error: ${String(error)}`)
          );
      },
      (error: unknown) => console.warn(`[daemon] user-message subscriber error: ${String(error)}`)
    );
  };
  subscribe();
  return {
    async stop() {
      stopped = true;
      unsubscribe();
      await processing;
    },
  };
}
