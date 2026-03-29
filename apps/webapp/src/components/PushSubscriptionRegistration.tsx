'use client';

import { usePushSubscription } from '@/hooks/usePushSubscription';

/**
 * Invisible component that registers the browser for Web Push notifications.
 *
 * Must be rendered inside an authenticated context so it can access
 * session-aware Convex hooks. Registers the push subscription once on mount.
 *
 * Renders nothing — side-effects only.
 */
export function PushSubscriptionRegistration() {
  usePushSubscription();
  return null;
}
