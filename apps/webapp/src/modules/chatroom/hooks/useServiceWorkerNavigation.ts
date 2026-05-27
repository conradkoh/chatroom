'use client';

import { useCallback, useEffect } from 'react';

import { useRouter } from 'next/navigation';

/**
 * Service Worker message types we care about.
 */
interface NavigateToChatroomMessage {
  type: 'NAVIGATE_TO_CHATROOM';
  chatroomId?: string;
}

type SwMessage = NavigateToChatroomMessage;

/**
 * Subscribes to `navigator.serviceWorker` message events and soft-navigates
 * to the target chatroom when a `NAVIGATE_TO_CHATROOM` message is received.
 *
 * The service worker sends this message when the user clicks a notification,
 * instead of doing a hard reload via `client.navigate`.
 */
export function useServiceWorkerNavigation() {
  const router = useRouter();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const msg = event.data as SwMessage | undefined;
      if (!msg || msg.type !== 'NAVIGATE_TO_CHATROOM') return;
      const chatroomId = msg.chatroomId;
      if (!chatroomId) return;
      router.replace(`/app/chatroom?id=${chatroomId}`, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [handleMessage]);
}
