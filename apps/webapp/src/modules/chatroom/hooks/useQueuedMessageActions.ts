import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

/** Shared promote/delete handlers for queued message UI surfaces. */
export function useQueuedMessageActions() {
  const promoteSpecificTask = useSessionMutation(api.tasks.promoteSpecificTask);
  const deleteUserMessageOrTask = useSessionMutation(api.messages.deleteUserMessageOrTask);

  const promoteQueuedMessage = useCallback(
    async (queuedMessageId: string) => {
      try {
        await promoteSpecificTask({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to promote queued message:', error);
      }
    },
    [promoteSpecificTask]
  );

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

  return { promoteQueuedMessage, deleteQueuedMessage };
}
