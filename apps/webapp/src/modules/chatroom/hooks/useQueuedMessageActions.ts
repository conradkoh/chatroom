import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

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
