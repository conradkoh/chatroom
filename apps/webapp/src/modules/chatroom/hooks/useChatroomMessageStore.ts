'use client';

/**
 * useChatroomMessageStore — message fetch + local merge for the timeline.
 *
 * Pass 1 (release behavior): same model as legacy useMessages — reactive
 * subscribeLatestMessages tail + imperative listMessagesBefore pagination.
 *
 * UI hooks (useChatroomTimeline, useChatroomTimelineFeedData) read from here;
 * ChatroomTimelineFeed should not call Convex message APIs directly.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logLoadOlder } from '../components/timeline/timelineLoadOlderDebug';
import type { Message } from '../types/message';

export const MESSAGE_SUBSCRIPTION_LIMIT = 20;
export const MESSAGE_LOAD_OLDER_PAGE_SIZE = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMessage(m: any): Message {
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

export interface UseChatroomMessageStoreResult {
  messages: Message[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: () => void;
}

export function useChatroomMessageStore(chatroomId: string): UseChatroomMessageStoreResult {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const convex = useConvex();
  const [sessionId] = useSessionId();

  const subscriptionResult = useSessionQuery(api.messageList.subscribeLatestMessages, {
    chatroomId: typedChatroomId,
    limit: MESSAGE_SUBSCRIPTION_LIMIT,
  });

  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [exhaustedOlder, setExhaustedOlder] = useState(false);
  const isLoadingOlderRef = useRef(false);
  const prevLiveRef = useRef<Message[]>([]);

  useEffect(() => {
    setOlderMessages([]);
    setExhaustedOlder(false);
    setIsLoadingOlder(false);
    isLoadingOlderRef.current = false;
    prevLiveRef.current = [];
  }, [chatroomId]);

  useEffect(() => {
    if (subscriptionResult === undefined) return;

    const live = subscriptionResult.map(toMessage);
    const prevLive = prevLiveRef.current;

    if (prevLive.length > 0) {
      const newLiveIds = new Set(live.map((m) => m._id));
      const dropped = prevLive.filter((m) => !newLiveIds.has(m._id));

      if (dropped.length > 0) {
        setOlderMessages((prev) => {
          const knownIds = new Set([
            ...prev.map((m) => m._id),
            ...live.map((m) => m._id),
          ]);
          const toPrepend = dropped
            .filter((m) => !knownIds.has(m._id))
            .sort((a, b) => a._creationTime - b._creationTime);
          if (toPrepend.length === 0) return prev;
          return [...toPrepend, ...prev];
        });
      }
    }

    prevLiveRef.current = live;
  }, [subscriptionResult]);

  const messages = useMemo(() => {
    const live = (subscriptionResult ?? []).map(toMessage);
    const olderIds = new Set(olderMessages.map((m) => m._id));
    const dedupedLive = live.filter((m) => !olderIds.has(m._id));
    return [...olderMessages, ...dedupedLive];
  }, [subscriptionResult, olderMessages]);

  const subLen = subscriptionResult?.length ?? 0;
  const hasMoreOlder = !exhaustedOlder && subLen >= MESSAGE_SUBSCRIPTION_LIMIT;

  const oldestMessageRef = useRef<Message | undefined>(undefined);
  oldestMessageRef.current = messages[0];

  const loadOlderMessages = useCallback(() => {
    if (isLoadingOlderRef.current) {
      logLoadOlder('loadOlderMessages skipped', { reason: 'in-flight' });
      return;
    }
    if (exhaustedOlder) {
      logLoadOlder('loadOlderMessages skipped', { reason: 'exhaustedOlder' });
      return;
    }
    if (!sessionId) {
      logLoadOlder('loadOlderMessages skipped', { reason: 'no sessionId' });
      return;
    }

    const oldest = oldestMessageRef.current;
    const before = oldest ? oldest._creationTime : Date.now();

    logLoadOlder('loadOlderMessages fetch', {
      before,
      oldestId: oldest?._id ?? null,
      currentCount: messages.length,
    });

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);

    void (async () => {
      try {
        const older = await convex.query(api.messageList.listMessagesBefore, {
          chatroomId: typedChatroomId,
          before,
          limit: MESSAGE_LOAD_OLDER_PAGE_SIZE,
          sessionId,
        });

        logLoadOlder('loadOlderMessages result', {
          fetched: older.length,
          before,
        });

        if (older.length === 0) {
          setExhaustedOlder(true);
        } else {
          setOlderMessages((prev) => [...older.map(toMessage), ...prev]);
          if (older.length < MESSAGE_LOAD_OLDER_PAGE_SIZE) {
            setExhaustedOlder(true);
          }
        }
      } catch (error) {
        logLoadOlder('loadOlderMessages error', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        isLoadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
    })();
  }, [convex, typedChatroomId, sessionId, exhaustedOlder, messages.length]);

  return {
    messages,
    isLoading: subscriptionResult === undefined,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderMessages,
  };
}
