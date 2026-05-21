'use client';

/**
 * useMessages — cursor-paginated message hook.
 *
 * Architecture:
 * 1. Historical — usePaginatedQuery(listMessages, initialNumItems=20)
 *    Pages are DESC by _creationTime; reversed to ASC for display.
 * 2. Tail — useSessionQuery(subscribeNewMessages, sinceCreationTime)
 *    Reactive; picks up messages strictly newer than the newest historical.
 * 3. Merge — historical (ASC) + deduped tail (ASC) → chronological order.
 *
 * taskStatus is resolved server-side by enrichMessages and flows through
 * both paginated and tail results via Convex query reactivity. No client-side
 * overlay is needed.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { useSessionPaginatedQuery } from '../../../lib/useSessionPaginatedQuery';
import type { Message } from '../types/message';

// ─── Internal helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMessage(m: any): Message {
  return {
    _id: m._id,
    type: m.type,
    senderRole: m.senderRole,
    targetRole: m.targetRole,
    content: m.content,
    _creationTime: m._creationTime,
    classification: m.classification,
    taskId: m.taskId,
    taskStatus: m.taskStatus,
    sourcePlatform: m.sourcePlatform,
    featureTitle: m.featureTitle,
    featureDescription: m.featureDescription,
    featureTechSpecs: m.featureTechSpecs,
    attachedTasks: m.attachedTasks,
    attachedBacklogItems: m.attachedBacklogItems,
    attachedArtifacts: m.attachedArtifacts,
    attachedMessages: m.attachedMessages,
    attachedWorkflows: m.attachedWorkflows,
    latestProgress: m.latestProgress,
    isQueued: m.isQueued,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  messages: Message[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: () => void;
  purgeOldMessages: (viewportTopIndex: number) => void;
}

export function useMessages(chatroomId: string): UseMessagesResult {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;

  // ── 1. Historical messages (paginated, descending) ──────────────────────
  const paginated = useSessionPaginatedQuery(
    api.messageList.listMessages,
    { chatroomId: typedChatroomId },
    { initialNumItems: 20 }
  );

  // ── 2. Tail subscription ──────────────────────────────────────────────
  const newestSeenCreationTime =
    paginated.results.length > 0 ? paginated.results[0]._creationTime : 0;

  const tail = useSessionQuery(
    api.messageList.subscribeNewMessages,
    paginated.status !== 'LoadingFirstPage'
      ? { chatroomId: typedChatroomId, sinceCreationTime: newestSeenCreationTime }
      : 'skip'
  );

  // ── 3. Merge: historical (ASC) + deduped tail (ASC) ───────────────────
  const messages = useMemo(() => {
    const historical = [...paginated.results].reverse().map(toMessage);
    const tailMessages = (tail ?? []).map(toMessage);

    // Deduplicate: tail may contain messages already in paginated on the boundary
    const seen = new Set(historical.map((m) => m._id));
    const dedupedTail = tailMessages.filter((m) => !seen.has(m._id));

    return [...historical, ...dedupedTail];
  }, [paginated.results, tail]);

  // ── Public API ────────────────────────────────────────────────────────

  const loadOlderMessages = useCallback(() => {
    paginated.loadMore(20);
  }, [paginated]);

  // No-op: usePaginatedQuery manages its own cache (no manual purge needed)
  const purgeOldMessages = useCallback((_viewportTopIndex: number) => {
    // Intentional no-op: cache managed by Convex's usePaginatedQuery
  }, []);

  return {
    messages,
    isLoading: paginated.status === 'LoadingFirstPage',
    hasMoreOlder: paginated.status === 'CanLoadMore',
    isLoadingOlder: paginated.status === 'LoadingMore',
    loadOlderMessages,
    purgeOldMessages,
  };
}
