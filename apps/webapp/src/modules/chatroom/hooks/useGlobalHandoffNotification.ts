'use client';

import { useEffect, useRef } from 'react';

import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

/**
 * Sends a notification via the Service Worker if available, otherwise
 * falls back to the window Notification API.
 */
function showNotification(title: string, body: string, tag: string): void {
  if (typeof window === 'undefined') return;

  // Try Service Worker first — richer notification support
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      payload: { title, body, tag },
    });
    return;
  }

  // Fallback: direct Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, { body, tag });
    setTimeout(() => notification.close(), 5000);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

/** Minimum interval between notifications (ms). */
const NOTIFICATION_THROTTLE_MS = 3000;

/**
 * Global notification hook that fires browser notifications when any chatroom
 * transitions to "unread" while the document is hidden.
 *
 * Unlike `useHandoffNotification` (which only watches the currently viewed
 * chatroom's messages), this hook monitors ALL chatrooms via the listing context
 * and fires notifications for any new unread activity.
 *
 * Mount this once at the app layout level (not per-chatroom).
 *
 * Only triggers when:
 * 1. A chatroom transitions from hasUnread=false to hasUnread=true
 * 2. The browser tab is NOT focused (document.hidden === true)
 * 3. At least NOTIFICATION_THROTTLE_MS has elapsed since the last notification
 */
export function useGlobalHandoffNotification(chatrooms: ChatroomWithStatus[] | undefined) {
  const prevUnreadMapRef = useRef<Map<string, boolean>>(new Map());
  const isInitialLoadRef = useRef(true);
  const isDocumentHiddenRef = useRef(
    typeof document !== 'undefined' ? document.hidden : false
  );
  const lastNotificationTimeRef = useRef(0);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Track document visibility
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      isDocumentHiddenRef.current = document.hidden;
    };

    isDocumentHiddenRef.current = document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Watch chatrooms for unread transitions
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

    // Detect chatrooms that became newly unread
    const newlyUnread: ChatroomWithStatus[] = [];
    const nextMap = new Map<string, boolean>();

    for (const chatroom of chatrooms) {
      nextMap.set(chatroom._id, chatroom.hasUnread);

      const wasUnread = prevUnreadMapRef.current.get(chatroom._id) ?? false;
      if (chatroom.hasUnread && !wasUnread) {
        newlyUnread.push(chatroom);
      }
    }

    prevUnreadMapRef.current = nextMap;

    // Fire notification for newly unread chatrooms (only when tab is hidden)
    if (newlyUnread.length > 0 && isDocumentHiddenRef.current) {
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
  }, [chatrooms]);
}
