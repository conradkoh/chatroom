'use client';

/**
 * useMessages — cursor-paginated message hook.
 *
 * Replaces useMessageStore's manual cursor management with Convex's built-in
 * usePaginatedQuery for historical messages and a reactive tail subscription
 * for new arrivals.
 *
 * Public API mirrors useMessageStore exactly so MessageFeed can swap with
 * zero behavioral change.
 *
 * Architecture:
 * 1. Historical — usePaginatedQuery(listMessages, initialNumItems=20)
 *    Pages are DESC by _creationTime; reversed to ASC for display.
 * 2. Tail — useSessionQuery(subscribeNewMessages, sinceCreationTime)
 *    Reactive; picks up messages strictly newer than the newest historical.
 * 3. Merge — historical (ASC) + deduped tail (ASC) → chronological order.
 * 4. Task-status — active-tasks subscription updates taskStatus on messages.
 * 5. Metadata-merge — active-task-messages subscription merges classification.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  updateTaskStatus: (taskId: string, newStatus: string) => void;
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
  // Gate on paginated.status to avoid a race where the tail fires before the
  // first page is loaded. results are DESC, so index 0 is the newest.
  const newestSeenCreationTime =
    paginated.results.length > 0 ? paginated.results[0]._creationTime : 0;

  const tail = useSessionQuery(
    api.messageList.subscribeNewMessages,
    paginated.status !== 'LoadingFirstPage'
      ? { chatroomId: typedChatroomId, sinceCreationTime: newestSeenCreationTime }
      : 'skip'
  );

  // ── 3. Merge: historical (ASC) + deduped tail (ASC) ───────────────────
  // Task-status and metadata overrides are applied reactively via separate
  // subscriptions below; we track them in state so useMemo can incorporate them.
  const [taskStatusMap, setTaskStatusMap] = useState<Map<string, string>>(new Map());
  const [metadataMap, setMetadataMap] = useState<Map<string, Partial<Message>>>(new Map());

  const messages = useMemo(() => {
    // Reverse DESC paginated results to get ASC chronological order
    const historical = [...paginated.results].reverse().map(toMessage);
    const tailMessages = (tail ?? []).map(toMessage);

    // Deduplicate: tail may contain messages already in paginated on the boundary
    const seen = new Set(historical.map((m) => m._id));
    const dedupedTail = tailMessages.filter((m) => !seen.has(m._id));

    const merged = [...historical, ...dedupedTail];

    // Apply task-status overlays
    if (taskStatusMap.size === 0 && metadataMap.size === 0) return merged;

    return merged.map((m) => {
      const taskStatus = m.taskId ? (taskStatusMap.get(m.taskId as string) ?? m.taskStatus) : m.taskStatus;
      const metadata = metadataMap.get(m._id as string);
      if (!metadata && taskStatus === m.taskStatus) return m;
      return { ...m, taskStatus: taskStatus as Message['taskStatus'], ...metadata };
    });
  }, [paginated.results, tail, taskStatusMap, metadataMap]);

  // ── 4. Task-status subscription ───────────────────────────────────────
  const activeTasks = useSessionQuery(api.tasks.listTasks, {
    chatroomId: typedChatroomId,
    statusFilter: 'active',
  });

  const prevActiveTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeTasks) return;

    const currentIds = new Set(activeTasks.map((t) => t._id as string));

    setTaskStatusMap((prev) => {
      const next = new Map(prev);
      // Update currently active tasks
      for (const task of activeTasks) {
        next.set(task._id as string, task.status);
      }
      // Mark completed tasks (left the active set)
      for (const prevId of prevActiveTaskIdsRef.current) {
        if (!currentIds.has(prevId)) {
          next.set(prevId, 'completed');
        }
      }
      return next;
    });

    prevActiveTaskIdsRef.current = currentIds;
  }, [activeTasks]);

  // ── 5. Metadata-merge subscription ────────────────────────────────────
  const activeTaskMessages = useSessionQuery(api.messages.getActiveTaskMessages, {
    chatroomId: typedChatroomId,
  });

  useEffect(() => {
    if (!activeTaskMessages || activeTaskMessages.messages.length === 0) return;

    setMetadataMap((prev) => {
      const next = new Map(prev);
      for (const m of activeTaskMessages.messages) {
        const existing = next.get(m._id as string) ?? {};
        next.set(m._id as string, {
          ...existing,
          classification: m.classification,
          featureTitle: m.featureTitle,
          featureDescription: m.featureDescription,
          featureTechSpecs: m.featureTechSpecs,
          taskStatus: m.taskStatus,
        });
      }
      return next;
    });
  }, [activeTaskMessages]);

  // ── Public API ────────────────────────────────────────────────────────

  const loadOlderMessages = useCallback(() => {
    paginated.loadMore(20);
  }, [paginated]);

  // No-op: usePaginatedQuery manages its own cache (no manual purge needed)
  const purgeOldMessages = useCallback((_viewportTopIndex: number) => {
    // Intentional no-op: cache managed by Convex's usePaginatedQuery
  }, []);

  // No-op: task status is managed reactively by the activeTasks subscription
  const updateTaskStatus = useCallback((_taskId: string, _newStatus: string) => {
    // Intentional no-op: managed reactively via activeTasks subscription
  }, []);

  return {
    messages,
    isLoading: paginated.status === 'LoadingFirstPage',
    hasMoreOlder: paginated.status === 'CanLoadMore',
    isLoadingOlder: paginated.status === 'LoadingMore',
    loadOlderMessages,
    purgeOldMessages,
    updateTaskStatus,
  };
}
