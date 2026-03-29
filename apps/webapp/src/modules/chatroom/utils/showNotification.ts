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
 */
export function showNotification(title: string, body: string, tag: string): void {
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
