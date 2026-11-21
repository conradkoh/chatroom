import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { getErrorMessage } from '@/lib/convexError';

// Define the discussion state type
type DiscussionState = {
  key: string;
  title: string;
  isActive: boolean;
  createdAt: number;
  exists: boolean;
  conclusions?: {
    text: string;
    tags: string[];
  }[];
  concludedAt?: number;
  concludedBy?: string;
  _id?: unknown;
  _creationTime?: number;
};

// Define the discussion message type
type DiscussionMessage = {
  _id: string;
  discussionKey: string;
  name: string;
  message: string;
  timestamp: number;
  sessionId?: string;
  _creationTime?: number;
};

// Define the discussion conclusion type
type DiscussionConclusion = {
  _id: string;
  discussionKey: string;
  conclusions: {
    text: string;
    tags: string[];
  }[];
  createdAt: number;
  createdBy?: string;
  _creationTime?: number;
};

export type DiscussionErrorScope =
  'create' | 'add' | 'delete' | 'conclude' | 'update-conclusions' | 'reopen';

/** The latest failed discussion mutation. `title` is the existing failure copy; `message` is the cause, or '' when there is none. */
export interface DiscussionError {
  scope: DiscussionErrorScope;
  title: string;
  message: string;
}

export function useDiscussionSync({ key, title }: { key: string; title: string }) {
  // Store user's name for messages
  const [userName, setUserName] = useState<string>('');

  // Get discussion state from backend
  const discussionState = useSessionQuery(
    api.discussions.getDiscussionState,
    key ? { key } : 'skip'
  ) as DiscussionState | undefined;

  // Get discussion messages from backend
  const messages = useSessionQuery(
    api.discussions.getDiscussionMessages,
    key ? { key } : 'skip'
  ) as DiscussionMessage[] | undefined;

  // Get discussion conclusion from backend
  const conclusion = useSessionQuery(
    api.discussions.getDiscussionConclusion,
    key ? { key } : 'skip'
  ) as DiscussionConclusion | null | undefined;

  // Mutations
  const createDiscussionMutation = useSessionMutation(api.discussions.createDiscussion);
  const addMessageMutation = useSessionMutation(api.discussions.addDiscussionMessage);
  const concludeDiscussionMutation = useSessionMutation(api.discussions.concludeDiscussion);
  const reopenDiscussionMutation = useSessionMutation(api.discussions.reopenDiscussion);
  const deleteMessageMutation = useSessionMutation(api.discussions.deleteDiscussionMessage);
  const updateConclusionsMutation = useSessionMutation(api.discussions.updateConclusions);

  const [discussionError, setDiscussionError] = useState<DiscussionError | null>(null);

  const clearError = useCallback(() => setDiscussionError(null), []);

  const reportError = useCallback((scope: DiscussionErrorScope, title: string, cause: unknown) => {
    setDiscussionError({ scope, title, message: getErrorMessage(cause, '') });
  }, []);

  // Check if discussion exists
  const exists = discussionState?.exists || false;
  const isActive = discussionState?.isActive || false;
  const isConcluded = exists && !isActive;

  // Create discussion if it doesn't exist
  const createDiscussion = useCallback(async () => {
    clearError();
    if (!key || !title) return;

    try {
      await createDiscussionMutation({
        key,
        title,
      });
    } catch (error) {
      reportError('create', 'Failed to create discussion', error);
    }
  }, [key, title, createDiscussionMutation, clearError, reportError]);

  // Add message to discussion
  const addMessage = useCallback(
    async (name: string, message: string) => {
      clearError();
      if (!key || !name || !message) return;

      try {
        await addMessageMutation({
          discussionKey: key,
          name,
          message,
        });

        // Save name for future use
        setUserName(name);

        return true;
      } catch (error) {
        reportError('add', 'Failed to add message', error);
        return false;
      }
    },
    [key, addMessageMutation, clearError, reportError]
  );

  // Delete message from discussion
  const deleteMessage = useCallback(
    async (messageId: Id<'discussionMessages'>) => {
      clearError();
      if (!messageId) return false;

      try {
        await deleteMessageMutation({
          messageId,
        });

        return true;
      } catch (error) {
        reportError('delete', 'Failed to delete message', error);
        return false;
      }
    },
    [deleteMessageMutation, clearError, reportError]
  );

  // Conclude discussion
  const concludeDiscussion = useCallback(
    async (conclusions: { text: string; tags: string[] }[]) => {
      clearError();
      if (!key) return;

      try {
        await concludeDiscussionMutation({
          discussionKey: key,
          conclusions,
        });

        return true;
      } catch (error) {
        reportError('conclude', 'Failed to conclude discussion', error);
        return false;
      }
    },
    [key, concludeDiscussionMutation, clearError, reportError]
  );

  // Update conclusions for an existing discussion
  const updateConclusions = useCallback(
    async (conclusions: { text: string; tags: string[] }[]) => {
      clearError();
      if (!key) return;

      try {
        await updateConclusionsMutation({
          discussionKey: key,
          conclusions,
        });

        return true;
      } catch (error) {
        reportError('update-conclusions', 'Failed to update conclusions', error);
        return false;
      }
    },
    [key, updateConclusionsMutation, clearError, reportError]
  );

  // Reopen discussion
  const reopenDiscussion = useCallback(async () => {
    clearError();
    if (!key) return;

    try {
      await reopenDiscussionMutation({
        discussionKey: key,
      });

      return true;
    } catch (error) {
      reportError('reopen', 'Failed to reopen discussion', error);
      return false;
    }
  }, [key, reopenDiscussionMutation, clearError, reportError]);

  // Initialize discussion if it doesn't exist yet
  const initializeDiscussion = useCallback(async () => {
    if (!exists && key && title) {
      await createDiscussion();
    }
  }, [exists, key, title, createDiscussion]);

  // Get the latest messages (limited by count)
  const getLatestMessages = useCallback(
    (count = 3) => {
      if (!messages || messages.length === 0) return [];
      return messages.slice(0, count);
    },
    [messages]
  );

  return {
    discussionState,
    messages,
    conclusion,
    exists,
    isActive,
    isConcluded,
    userName,
    setUserName,
    createDiscussion,
    addMessage,
    deleteMessage,
    concludeDiscussion,
    updateConclusions,
    reopenDiscussion,
    initializeDiscussion,
    getLatestMessages,
    error: discussionError, // latest failed discussion mutation, or null
    clearError, // dismisses it
  };
}
