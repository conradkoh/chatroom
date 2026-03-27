'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Minimal message shape needed for handoff notification detection.
 */
interface NotifiableMessage {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
}

/** Minimum interval between notifications (ms). */
const NOTIFICATION_THROTTLE_MS = 3000;

/** Maximum number of message IDs to track in the notified set. */
const MAX_NOTIFIED_IDS = 500;

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

/**
 * Trims the notified IDs set to stay within MAX_NOTIFIED_IDS.
 * Removes the oldest entries (Sets iterate in insertion order).
 */
function trimNotifiedIds(ids: Set<string>): void {
  if (ids.size <= MAX_NOTIFIED_IDS) return;
  const excess = ids.size - MAX_NOTIFIED_IDS;
  let removed = 0;
  for (const id of ids) {
    if (removed >= excess) break;
    ids.delete(id);
    removed++;
  }
}

/**
 * Fires a browser notification when a new handoff message targets the user.
 *
 * Prefers the Service Worker notification API (via postMessage) for richer
 * notification support. Falls back to window.Notification when the SW is
 * not available.
 *
 * Only triggers when:
 * 1. The browser tab is NOT focused (tracked via visibilitychange listener)
 * 2. The message is a handoff to the user (type === 'handoff' && targetRole === 'user')
 * 3. We haven't already notified for this message ID
 * 4. At least NOTIFICATION_THROTTLE_MS has elapsed since the last notification
 *
 * Requests notification permission on mount if not already granted/denied.
 */
export function useHandoffNotification(messages: NotifiableMessage[]) {
  const notifiedIdsRef = useRef(new Set<string>());
  const isInitialLoadRef = useRef(true);
  const isDocumentHiddenRef = useRef(
    typeof document !== 'undefined' ? document.hidden : false
  );
  const lastNotificationTimeRef = useRef(0);

  // Request permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
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

  const fireNotification = useCallback((senderRole: string) => {
    showNotification(
      'Chatroom Handoff',
      `${senderRole} has handed off to you`,
      'chatroom-handoff'
    );
  }, []);

  // Detect new handoff messages and fire notifications
  useEffect(() => {
    // On initial load, mark all existing messages as seen (don't notify)
    if (isInitialLoadRef.current) {
      if (messages.length > 0) {
        for (const msg of messages) {
          notifiedIdsRef.current.add(msg._id);
        }
        isInitialLoadRef.current = false;
      }
      return;
    }

    // Check for new messages
    for (const msg of messages) {
      if (notifiedIdsRef.current.has(msg._id)) continue;
      notifiedIdsRef.current.add(msg._id);

      if (
        msg.type === 'handoff' &&
        msg.targetRole?.toLowerCase() === 'user' &&
        isDocumentHiddenRef.current
      ) {
        const now = Date.now();
        if (now - lastNotificationTimeRef.current >= NOTIFICATION_THROTTLE_MS) {
          lastNotificationTimeRef.current = now;
          fireNotification(msg.senderRole);
        }
      }
    }

    // Prevent unbounded growth of the notified IDs set
    trimNotifiedIds(notifiedIdsRef.current);
  }, [messages, fireNotification]);
}
