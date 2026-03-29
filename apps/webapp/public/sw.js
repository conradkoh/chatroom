/**
 * Chatroom Service Worker
 *
 * Responsibilities:
 * - Show browser notifications on behalf of the app (richer API than window.Notification)
 * - Handle push events from the server (Web Push API)
 * - Handle notification clicks to focus/open the app tab
 *
 * Communication:
 * - Receives messages from the app via postMessage
 * - Receives push events from the server via Web Push API
 * - Message format: { type: string, payload: object }
 */

const SW_VERSION = '1.1.0';

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

// ─── Push Event Handling (Web Push API) ──────────────────────────────────────

/**
 * Handles push events from the server.
 *
 * This fires even when the tab is closed or the browser is in the background.
 * The server sends a JSON payload with { title, body, tag, url }.
 */
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('[SW] Push event with no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (err) {
    console.warn('[SW] Failed to parse push data:', err);
    data = { title: 'Chatroom', body: event.data.text() };
  }

  const { title, body, tag, url } = data;

  event.waitUntil(
    self.registration.showNotification(title || 'Chatroom', {
      body: body || '',
      tag: tag || 'chatroom-push',
      icon: '/appicon-192x192.png',
      badge: '/appicon-96x96.png',
      requireInteraction: false,
      data: { url }, // Store URL for notification click handler
    })
  );
});

// ─── Message Handling (postMessage from app) ─────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SHOW_NOTIFICATION': {
      const { title, body, tag } = payload || {};
      event.waitUntil(
        self.registration.showNotification(title || 'Chatroom', {
          body: body || '',
          tag: tag || 'chatroom-default',
          icon: '/appicon-192x192.png',
          badge: '/appicon-96x96.png',
          requireInteraction: false,
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

  // Check if the notification has a URL (from push event data)
  const notificationUrl = event.notification.data?.url;
  const targetUrl = notificationUrl || '/app';

  // Try to focus an existing app tab, or open a new one
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus the first matching tab
        for (const client of clientList) {
          if (client.url.includes('/app') && 'focus' in client) {
            // Navigate to the specific chatroom if URL is provided
            if (notificationUrl) {
              client.navigate(targetUrl);
            }
            return client.focus();
          }
        }
        // No existing tab — open the app at the target URL
        return self.clients.openWindow(targetUrl);
      })
  );
});
