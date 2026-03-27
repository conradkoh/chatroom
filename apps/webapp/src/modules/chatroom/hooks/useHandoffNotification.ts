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
  _creationTime: number;
}

/** Minimum interval between notifications (ms). */
const NOTIFICATION_THROTTLE_MS = 3000;

/**
 * Fires a browser notification when a new handoff message targets the user.
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

  // Request notification permission on first mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  // Track document visibility in real-time via event listener
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      isDocumentHiddenRef.current = document.hidden;
    };

    // Sync initial value
    isDocumentHiddenRef.current = document.hidden;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const fireNotification = useCallback((senderRole: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const notification = new Notification('Chatroom Handoff', {
      body: `${senderRole} has handed off to you`,
      tag: 'chatroom-handoff', // Prevents duplicate notifications stacking
    });

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);

    // Focus the window when clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, []);

  // Unified effect: mark initial messages as seen OR fire notifications for new handoffs
  useEffect(() => {
    // On first run with messages: mark all IDs and return without notifying
    if (isInitialLoadRef.current) {
      if (messages.length > 0) {
        for (const msg of messages) {
          notifiedIdsRef.current.add(msg._id);
        }
        isInitialLoadRef.current = false;
      }
      return;
    }

    // Subsequent runs: detect new messages and notify for handoffs to user
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
  }, [messages, fireNotification]);
}
