'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useQuery } from 'convex/react';
import { useEffect, useRef } from 'react';

/**
 * Registers the browser for Web Push notifications.
 *
 * Flow:
 * 1. Fetch the VAPID public key from the Convex backend
 * 2. Subscribe the Service Worker's push manager to the push service
 * 3. Send the subscription details (endpoint + keys) to the backend for storage
 *
 * Only subscribes if:
 * - Service Worker is registered and active
 * - Notification permission is granted
 * - VAPID public key is configured on the backend
 * - Not already subscribed (checks existing subscription first)
 *
 * Re-runs when the VAPID key or session changes, ensuring the subscription
 * is always in sync.
 */
export function usePushSubscription() {
  const vapidPublicKey = useQuery(api.pushNotifications.getVapidPublicKey);
  const subscribe = useSessionMutation(api.pushNotifications.subscribe);
  const hasSubscribedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (!('PushManager' in window)) return;
    if (!vapidPublicKey) return;
    if (hasSubscribedRef.current) return;

    async function registerPushSubscription() {
      try {
        const registration = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          // Ensure notification permission is granted
          if (Notification.permission !== 'granted') {
            const result = await Notification.requestPermission();
            if (result !== 'granted') return;
          }

          // Subscribe to push service
          const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey!);
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey as unknown as ArrayBuffer,
          });
        }

        // Extract keys and send to backend
        const rawKey = subscription.getKey('p256dh');
        const rawAuth = subscription.getKey('auth');

        if (!rawKey || !rawAuth) {
          console.warn('[Push] Subscription missing keys');
          return;
        }

        const p256dh = arrayBufferToBase64(rawKey);
        const auth = arrayBufferToBase64(rawAuth);

        await subscribe({
          endpoint: subscription.endpoint,
          p256dh,
          auth,
        });

        hasSubscribedRef.current = true;
        console.log('[Push] Subscription registered with backend');
      } catch (err) {
        console.warn('[Push] Failed to register push subscription:', err);
      }
    }

    registerPushSubscription();
  }, [vapidPublicKey, subscribe]);
}

/**
 * Converts a URL-safe base64 string to a Uint8Array.
 * Required by PushManager.subscribe() for the applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Converts an ArrayBuffer to a standard base64 string.
 * Used to encode the p256dh and auth keys for storage.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
