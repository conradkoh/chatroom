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

/**
 * Fires a browser notification when a new handoff message targets the user.
 *
 * Only triggers when:
 * 1. The browser tab is NOT focused (document.hidden)
 * 2. The message is a handoff to the user (type === 'handoff' && targetRole === 'user')
 * 3. We haven't already notified for this message ID
 *
 * Requests notification permission on mount if not already granted/denied.
 */
export function useHandoffNotification(messages: NotifiableMessage[]) {
  const notifiedIdsRef = useRef(new Set<string>());
  const isInitialLoadRef = useRef(true);

  // Request notification permission on first mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  // Mark initial messages as already "seen" so we don't notify on page load
  useEffect(() => {
    if (isInitialLoadRef.current && messages.length > 0) {
      for (const msg of messages) {
        notifiedIdsRef.current.add(msg._id);
      }
      isInitialLoadRef.current = false;
    }
  }, [messages]);

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

  // Check for new handoff messages targeting the user
  useEffect(() => {
    if (isInitialLoadRef.current) return;

    for (const msg of messages) {
      if (notifiedIdsRef.current.has(msg._id)) continue;
      notifiedIdsRef.current.add(msg._id);

      if (
        msg.type === 'handoff' &&
        msg.targetRole?.toLowerCase() === 'user' &&
        document.hidden
      ) {
        fireNotification(msg.senderRole);
      }
    }
  }, [messages, fireNotification]);
}
