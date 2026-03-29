'use client';

import { useEffect, useRef } from 'react';

import type { ChatroomWithStatus } from '../context/ChatroomListingContext';
import { showNotification } from '../utils/showNotification';

/** Minimum interval between notifications (ms). */
const NOTIFICATION_THROTTLE_MS = 3000;

/**
 * Global notification hook that fires browser notifications when any chatroom
 * transitions to "unread."
 *
 * Unlike `useHandoffNotification` (which only watches the currently viewed
 * chatroom's messages), this hook monitors ALL chatrooms via the listing context
 * and fires notifications for any new unread activity.
 *
 * ## Design decisions (WhatsApp Web-inspired):
 *
 * 1. **Notify regardless of tab focus** — WhatsApp Web shows notifications
 *    even when the tab is visible. Users may have the tab open but not be
 *    actively looking at it. We follow the same pattern. The tab being visible
 *    does NOT suppress notifications.
 *
 * 2. **Catch-up on visibility change** — Browsers throttle background tabs,
 *    which delays Convex subscription updates. When the tab regains focus,
 *    we immediately check for missed unread transitions and fire any
 *    pending notifications. This addresses the "delayed notification" issue.
 *
 * 3. **Transition detection, not state polling** — We track previous unread
 *    state per chatroom and only notify on false→true transitions, preventing
 *    duplicate notifications for the same unread chatroom.
 *
 * ## Limitations:
 *
 * This approach still relies on the client-side Convex subscription being
 * active. For truly background/offline push notifications (like WhatsApp
 * mobile), a server-side Web Push implementation would be needed. That
 * requires a push subscription endpoint (e.g. Firebase Cloud Messaging)
 * and server-side push on message creation.
 *
 * Mount this once at the app layout level (not per-chatroom).
 */
export function useGlobalHandoffNotification(chatrooms: ChatroomWithStatus[] | undefined) {
  const prevUnreadMapRef = useRef<Map<string, boolean>>(new Map());
  const isInitialLoadRef = useRef(true);
  const lastNotificationTimeRef = useRef(0);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  /**
   * Core notification logic: detect newly unread chatrooms and fire notification.
   * Extracted so it can be called both from the subscription effect and the
   * visibility-change catch-up handler.
   */
  const processUnreadTransitions = (currentChatrooms: ChatroomWithStatus[]) => {
    const newlyUnread: ChatroomWithStatus[] = [];
    const nextMap = new Map<string, boolean>();

    for (const chatroom of currentChatrooms) {
      nextMap.set(chatroom._id, chatroom.hasUnread);

      const wasUnread = prevUnreadMapRef.current.get(chatroom._id) ?? false;
      if (chatroom.hasUnread && !wasUnread) {
        newlyUnread.push(chatroom);
      }
    }

    prevUnreadMapRef.current = nextMap;

    // Fire notification for newly unread chatrooms
    if (newlyUnread.length > 0) {
      const now = Date.now();
      if (now - lastNotificationTimeRef.current >= NOTIFICATION_THROTTLE_MS) {
        lastNotificationTimeRef.current = now;

        if (newlyUnread.length === 1) {
          const chatroom = newlyUnread[0]!;
          const name = chatroom.name || 'Chatroom';
          showNotification('New Message', `Activity in ${name}`, `chatroom-unread-${chatroom._id}`);
        } else {
          showNotification(
            'New Messages',
            `Activity in ${newlyUnread.length} chatrooms`,
            'chatroom-unread-batch'
          );
        }
      }
    }
  };

  // Catch-up on tab visibility change: when the tab becomes visible again,
  // the Convex subscription will soon deliver fresh data. However, we also
  // need to check the current state in case the subscription already updated
  // while we were throttled in the background.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (!document.hidden && chatrooms && !isInitialLoadRef.current) {
        // Tab just became visible — process any missed transitions
        processUnreadTransitions(chatrooms);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatrooms]);

  // Watch chatrooms for unread transitions (primary path)
  useEffect(() => {
    if (!chatrooms) return;

    // On initial load, snapshot current state without notifying
    if (isInitialLoadRef.current) {
      const initialMap = new Map<string, boolean>();
      for (const chatroom of chatrooms) {
        initialMap.set(chatroom._id, chatroom.hasUnread);
      }
      prevUnreadMapRef.current = initialMap;
      isInitialLoadRef.current = false;
      return;
    }

    processUnreadTransitions(chatrooms);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatrooms]);
}
