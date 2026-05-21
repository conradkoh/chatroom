/**
 * Pure decision logic for notification-click handling in the service worker.
 *
 * Determines whether to focus-and-postMessage an existing tab, or open a new
 * window, based on the current client tabs and the chatroom ID from the
 * notification payload.
 *
 * This is a pure function — no DOM, no navigator. It exists solely to anchor
 * the unit-test contract.
 */

export type NotificationClickAction =
  | { kind: 'focus-and-post'; clientIndex: number; chatroomId?: string }
  | { kind: 'open-window'; url: string };

export function decideNotificationClickAction(
  clients: Array<{ url: string }>,
  chatroomId?: string
): NotificationClickAction {
  // 1. Exact match: an app tab already open to this chatroom
  if (chatroomId) {
    const exactMatchIdx = clients.findIndex((c) => c.url.includes(`id=${chatroomId}`));
    if (exactMatchIdx !== -1) {
      return { kind: 'focus-and-post', clientIndex: exactMatchIdx, chatroomId };
    }
  }

  // 2. Any app tab exists — focus and post (with chatroomId if known)
  const appTabIdx = clients.findIndex((c) => c.url.includes('/app'));
  if (appTabIdx !== -1) {
    return { kind: 'focus-and-post', clientIndex: appTabIdx, chatroomId };
  }

  // 3. No app tab — open a new window
  const url = chatroomId ? `/app/chatroom?id=${chatroomId}` : '/app';
  return { kind: 'open-window', url };
}
