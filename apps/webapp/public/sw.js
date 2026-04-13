/**
 * Chatroom Service Worker
 *
 * Responsibilities:
 * - Show browser notifications on behalf of the app (richer API than window.Notification)
 * - Handle notification clicks to focus/open the app tab
 *
 * Communication:
 * - Receives messages from the app via postMessage
 * - Message format: { type: string, payload: object }
 */

const SW_VERSION = '1.0.0';

// ─── Lifecycle Events ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing...`);
  // Activate immediately — don't wait for existing tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activated`);
  // Claim all open clients so we can start receiving messages immediately
  event.waitUntil(self.clients.claim());
});

// ─── Message Handling ────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SHOW_NOTIFICATION': {
      const { title, body, tag, chatroomId } = payload || {};
      event.waitUntil(
        self.registration.showNotification(title || 'Chatroom', {
          body: body || '',
          tag: tag || 'chatroom-default',
          icon: '/appicon-192x192.png',
          badge: '/appicon-96x96.png',
          requireInteraction: false,
          data: chatroomId ? { chatroomId } : undefined,
        })
      );
      break;
    }

    case 'PING': {
      // Health check — respond to confirm SW is alive
      if (event.source) {
        event.source.postMessage({ type: 'PONG', version: SW_VERSION });
      }
      break;
    }

    default:
      console.log(`[SW] Unknown message type: ${type}`);
  }
});

// ─── Notification Click ──────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Get chatroomId from notification data if available
  const chatroomId = event.notification.data?.chatroomId;
  const targetUrl = chatroomId ? `/app/${chatroomId}` : '/app';

  // Try to focus an existing app tab, or open a new one
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus the first matching tab with the same chatroom
        for (const client of clientList) {
          if (chatroomId && client.url.includes(`/app/${chatroomId}`) && 'focus' in client) {
            return client.focus();
          }
          // Fallback: focus any app tab
          if (client.url.includes('/app') && 'focus' in client) {
            return client.focus();
          }
        }
        // No existing tab — open the app (with correct chatroom if specified)
        return self.clients.openWindow(targetUrl);
      })
  );
});
