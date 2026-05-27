'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker on mount.
 *
 * Placed near the root layout so the SW is registered once for the entire app.
 * The SW file lives at /sw.js (served from apps/webapp/public/sw.js).
 *
 * Registration is a no-op when:
 * - Running on the server (SSR)
 * - Service workers are not supported
 * - Already registered (browser deduplicates)
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[SW] Registered:', registration.scope);
      })
      .catch((error) => {
        console.warn('[SW] Registration failed:', error);
      });
  }, []);

  return null;
}
