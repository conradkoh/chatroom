'use client';

/**
 * @deprecated Use `useDaemonConnected` from `@/hooks/useDaemonConnected` instead.
 * This hook uses direct localhost HTTP calls which are blocked by Safari's
 * mixed-content policy on HTTPS pages. The replacement queries Convex for
 * daemon presence, which works on all browsers.
 *
 * This file is retained for reference and as a potential fallback for
 * local development environments where Convex may not be available.
 */

import { useState, useEffect, useRef } from 'react';

/**
 * The response shape from GET http://localhost:19847/api/identity.
 * Mirrors the IdentityResponse type on the daemon side.
 */
interface LocalDaemonIdentity {
  machineId: string;
  hostname: string;
  os: string;
  version: string;
}

/**
 * Result returned by {@link useLocalDaemon}.
 */
export interface UseLocalDaemonResult {
  /**
   * Whether a daemon is running on the same machine as the browser.
   * `false` while loading or if no daemon is detected.
   */
  isLocal: boolean;
  /** Stable machine UUID from the running daemon, or null if not detected. */
  machineId: string | null;
  /** Machine hostname from the running daemon, or null if not detected. */
  hostname: string | null;
  /** true while the initial detection attempt is in flight. */
  isLoading: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default port the local daemon API listens on. */
const LOCAL_API_PORT = 19847;

/** Timeout (ms) for each ping attempt. */
const PING_TIMEOUT_MS = 2_000;

/** How often (ms) to re-ping the local daemon in case it starts up later. */
const RETRY_INTERVAL_MS = 30_000;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Attempt to fetch the daemon identity endpoint.
 * Returns the identity on success, or null if the daemon is not reachable.
 */
async function pingLocalDaemon(): Promise<LocalDaemonIdentity | null> {
  const url = `http://localhost:${LOCAL_API_PORT}/api/identity`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // Prevent the browser from caching the response
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const data = (await res.json()) as LocalDaemonIdentity;
    if (typeof data.machineId !== 'string') return null;

    return data;
  } catch {
    // Network error, timeout, or CORS block — treat as "not local"
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Detect whether the user's browser is running on the same machine as a
 * chatroom daemon.
 *
 * Pings the local daemon API on mount and retries every 30 seconds so the
 * status updates automatically if the daemon starts later.
 *
 * @example
 * ```tsx
 * const { isLocal, machineId } = useLocalDaemon();
 * if (isLocal) {
 *   return <button>Open in VS Code</button>;
 * }
 * ```
 */
export function useLocalDaemon(): UseLocalDaemonResult {
  const [isLoading, setIsLoading] = useState(true);
  const [identity, setIdentity] = useState<LocalDaemonIdentity | null>(null);

  // Stable ref to avoid stale-closure issues in the interval callback
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const detect = async () => {
      const result = await pingLocalDaemon();
      if (!isMountedRef.current) return;
      setIdentity(result);
      setIsLoading(false);
    };

    // Initial ping
    void detect();

    // Periodic retry in case the daemon starts after page load
    intervalId = setInterval(() => {
      void detect();
    }, RETRY_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, []);

  return {
    isLocal: identity !== null,
    machineId: identity?.machineId ?? null,
    hostname: identity?.hostname ?? null,
    isLoading,
  };
}
