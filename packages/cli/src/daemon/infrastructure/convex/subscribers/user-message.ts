import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';
import type { SubscriberHandle } from './workspace-list.js';

/** P7 message tail. The daemon supplies a chatroom cursor through subscriber deps. */
export function startUserMessageSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  if (!deps.chatroomId) return { async stop() {} };
  const unsub = deps.wsClient.onUpdate(
    api.messageList.subscribeNewMessages,
    { sessionId: deps.sessionId, chatroomId: deps.chatroomId as never, afterCreationTime: 0 },
    (messages: Array<{ _id: string; senderRole?: string }> | null) => {
      for (const message of messages ?? []) {
        if (message.senderRole === 'user') onEvent({ type: 'user-message.received', messageId: message._id });
      }
    },
    (error: unknown) => console.warn(`[daemon] user-message subscriber error: ${String(error)}`)
  );
  return { async stop() { unsub(); } };
}
