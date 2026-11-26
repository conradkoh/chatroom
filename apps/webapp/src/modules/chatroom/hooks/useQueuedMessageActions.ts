import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { QueuedReorderIntent, QueuedReorderOutcome } from './queuedReorderModel';

/** Shared delete handler for queued message UI surfaces. */
export function useQueuedMessageActions() {
  const deleteUserMessageOrTask = useSessionMutation(api.messages.deleteUserMessageOrTask);

  const deleteQueuedMessage = useCallback(
    async (queuedMessageId: string) => {
      try {
        await deleteUserMessageOrTask({
          type: 'message',
          messageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to delete queued message:', error);
      }
    },
    [deleteUserMessageOrTask]
  );

  return { deleteQueuedMessage };
}

/**
 * Reorders one queued message. Rejects on failure so the caller can show feedback.
 *
 * The backend resolves `'stale'` when the moved row or the anchor is no longer
 * queued; that result is passed through as-is.
 */
export function useReorderQueuedMessage(chatroomId: Id<'chatroom_rooms'>) {
  const reorder = useSessionMutation(api.messages.reorderQueuedMessage);
  return useCallback(
    async (intent: QueuedReorderIntent): Promise<QueuedReorderOutcome> =>
      reorder({
        chatroomId,
        movedId: intent.movedId as Id<'chatroom_messageQueue'>,
        afterId: intent.afterId as Id<'chatroom_messageQueue'> | null,
      }),
    [chatroomId, reorder]
  );
}
