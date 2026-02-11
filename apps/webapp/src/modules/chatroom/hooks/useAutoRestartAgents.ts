'use client';

import { useMemo, useRef, useState, useCallback } from 'react';

import type { TeamReadiness } from '../types/readiness';

// ─── Types ──────────────────────────────────────────────────────────

export interface AutoRestartNotification {
  /** Roles that are being restarted (by the backend) */
  restartingRoles: string[];
  /** Roles that could not be restarted (no machine config / daemon offline) */
  skippedRoles: string[];
}

// ─── Hook ───────────────────────────────────────────────────────────

/**
 * Hook that provides auto-restart awareness for the UI layer.
 *
 * The actual restart logic lives on the backend — when a task is created
 * targeting an offline agent, the backend automatically dispatches
 * stop + start commands. This hook provides UI feedback:
 *
 * 1. Detects when a message was sent to offline agents
 * 2. Returns notification state for toast/banner display
 *
 * It does NOT send any machine commands itself (the backend handles that).
 */
export function useAutoRestartAgents({
  readiness,
}: {
  chatroomId: string;
  readiness: TeamReadiness | null | undefined;
}) {
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastNotification, setLastNotification] = useState<AutoRestartNotification | null>(null);

  // Debounce: prevent multiple rapid notifications
  const lastNotifyTime = useRef<number>(0);
  const NOTIFY_COOLDOWN_MS = 10_000;

  // Compute offline roles from readiness
  const offlineRoles = useMemo(() => {
    if (!readiness) return [];
    const expired = readiness.expiredRoles || [];
    const missing = readiness.missingRoles || [];
    return [...new Set([...expired, ...missing].map((r) => r.toLowerCase()))];
  }, [readiness]);

  /**
   * Called after the user sends a message. Checks if agents are offline
   * and returns a notification about what the backend is doing.
   *
   * The backend handles the actual restart — this just provides UI feedback.
   */
  const notifyMessageSent = useCallback((): AutoRestartNotification | null => {
    if (offlineRoles.length === 0) {
      return null; // All agents are online — nothing to notify about
    }

    // Cooldown check
    const now = Date.now();
    if (now - lastNotifyTime.current < NOTIFY_COOLDOWN_MS) {
      return null;
    }
    lastNotifyTime.current = now;

    // Show "restarting" state briefly
    setIsRestarting(true);
    setTimeout(() => setIsRestarting(false), 5000); // Show for 5 seconds

    // All offline roles are being restarted by the backend
    // (the backend will skip roles without configs, but we don't know that here)
    const notification: AutoRestartNotification = {
      restartingRoles: offlineRoles,
      skippedRoles: [],
    };

    setLastNotification(notification);
    return notification;
  }, [offlineRoles]);

  return {
    /** Notify that a message was sent — returns UI notification info */
    notifyMessageSent,
    /** Whether agents are currently being restarted (for spinner display) */
    isRestarting,
    /** Last notification result */
    lastNotification,
    /** Whether there are offline agents */
    hasOfflineAgents: offlineRoles.length > 0,
  };
}
