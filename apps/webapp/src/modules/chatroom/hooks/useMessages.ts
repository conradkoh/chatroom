'use client';

/**
 * useMessages — subscription + imperative load-older hook.
 *
 * Architecture:
 * 1. Live tail — useSessionQuery(subscribeLatestMessages, limit=40)
 *    Reactive; always returns the latest N messages in chronological order.
 * 2. Older pages — useState + convex.query(listMessagesBefore) on scroll-to-top
 *    Imperative; prepended to local state.
 * 3. Merge — older (ASC) + deduped subscription (ASC) → chronological order.
 *
 * taskStatus is resolved server-side by enrichMessages and flows through
 * both sources via Convex query reactivity.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { Message } from '../types/message';

const SUBSCRIPTION_LIMIT = 40;
const LOAD_OLDER_PAGE_SIZE = 20;

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
  const convex = useConvex();
  const [sessionId] = useSessionId();

  const subscriptionResult = useSessionQuery(api.messageList.subscribeLatestMessages, {
    chatroomId: typedChatroomId,
    limit: SUBSCRIPTION_LIMIT,
  });

  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [exhaustedOlder, setExhaustedOlder] = useState(false);
  const isLoadingOlderRef = useRef(false);

  const messages = useMemo(() => {
    const live = (subscriptionResult ?? []).map(toMessage);
    const olderIds = new Set(olderMessages.map((m) => m._id));
    const dedupedLive = live.filter((m) => !olderIds.has(m._id));
    return [...olderMessages, ...dedupedLive];
  }, [subscriptionResult, olderMessages]);

  const subLen = subscriptionResult?.length ?? 0;
  const hasMoreOlder =
    !exhaustedOlder && (subLen >= SUBSCRIPTION_LIMIT || olderMessages.length > 0);

  const loadOlderMessages = useCallback(() => {
    if (isLoadingOlderRef.current || exhaustedOlder || !sessionId) return;

    const oldest = messages[0];
    const before = oldest ? oldest._creationTime : Date.now();

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);

    void (async () => {
      try {
        const older = await convex.query(api.messageList.listMessagesBefore, {
          chatroomId: typedChatroomId,
          before,
          limit: LOAD_OLDER_PAGE_SIZE,
          sessionId,
        });

        if (older.length === 0) {
          setExhaustedOlder(true);
        } else {
          setOlderMessages((prev) => [...older.map(toMessage), ...prev]);
          if (older.length < LOAD_OLDER_PAGE_SIZE) {
            setExhaustedOlder(true);
          }
        }
      } finally {
        isLoadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
    })();
  }, [convex, typedChatroomId, messages, sessionId, exhaustedOlder]);

  const purgeOldMessages = useCallback((_viewportTopIndex: number) => {
    // no-op for now
  }, []);

  return {
    messages,
    isLoading: subscriptionResult === undefined,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderMessages,
    purgeOldMessages,
  };
}
