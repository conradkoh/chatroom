'use client';

/**
 * Shared notification utility for sending browser notifications.
 *
 * Prefers the Service Worker notification API (via postMessage) for richer
 * notification support. Falls back to window.Notification when the SW is
 * not available.
 */

/**
 * Sends a notification via the Service Worker if available, otherwise
 * falls back to the window Notification API.
 *
 * @param chatroomId - Chatroom ID to navigate to when notification is clicked
 */
export function showNotification(
  title: string,
  body: string,
  tag: string,
  chatroomId?: string
): void {
  if (typeof window === 'undefined') return;

  // Try Service Worker first — richer notification support
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      payload: { title, body, tag, chatroomId },
    });
    return;
  }

  // Fallback: direct Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, { body, tag });
    setTimeout(() => notification.close(), 5000);
    notification.onclick = () => {
      window.focus();
      if (chatroomId) {
        window.location.href = `/app/${chatroomId}`;
      }
      notification.close();
    };
  }
}
