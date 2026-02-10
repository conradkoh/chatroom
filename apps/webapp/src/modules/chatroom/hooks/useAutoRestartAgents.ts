'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import type { AgentConfig, AgentHarness, SendCommandFn } from '../types/machine';
import type { TeamReadiness } from '../types/readiness';

// ─── Types ──────────────────────────────────────────────────────────

export interface AutoRestartResult {
  /** Roles that were successfully restarted */
  restarted: string[];
  /** Roles that could not be restarted (no config) */
  skipped: string[];
}

// ─── Hook ───────────────────────────────────────────────────────────

/**
 * Hook that provides auto-restart functionality for offline agents.
 *
 * When a user sends a message and agents are offline, this hook can
 * automatically send stop + start commands to restart them using their
 * existing agent configs (machine, harness, workingDir, model).
 *
 * Only restarts agents that have an existing agent config — if an agent
 * was never configured via the UI, it will be skipped.
 */
export function useAutoRestartAgents({
  chatroomId,
  readiness,
}: {
  chatroomId: string;
  readiness: TeamReadiness | null | undefined;
}) {
  const sendCommand = useSessionMutation(api.machines.sendCommand) as unknown as SendCommandFn;

  // Query agent configs for this chatroom
  const configsResult = useSessionQuery(api.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const [isRestarting, setIsRestarting] = useState(false);
  const [lastResult, setLastResult] = useState<AutoRestartResult | null>(null);

  // Debounce: prevent multiple rapid restarts
  const lastRestartTime = useRef<number>(0);
  const RESTART_COOLDOWN_MS = 10_000; // 10 seconds between restarts

  /**
   * Restart all offline agents that have an existing config.
   * Returns which roles were restarted vs. skipped.
   */
  const restartOfflineAgents = useCallback(async (): Promise<AutoRestartResult | null> => {
    // Guard: need readiness and configs data
    if (!readiness || !configsResult?.configs) {
      return null;
    }

    // Combine expired + missing roles as "offline"
    const offlineRoles = [...(readiness.expiredRoles || []), ...(readiness.missingRoles || [])];

    // Deduplicate (a role could appear in both lists)
    const uniqueOfflineRoles = [...new Set(offlineRoles.map((r) => r.toLowerCase()))];

    if (uniqueOfflineRoles.length === 0) {
      return null; // All agents are online
    }

    // Cooldown check
    const now = Date.now();
    if (now - lastRestartTime.current < RESTART_COOLDOWN_MS) {
      return null;
    }
    lastRestartTime.current = now;

    setIsRestarting(true);
    const restarted: string[] = [];
    const skipped: string[] = [];

    try {
      for (const role of uniqueOfflineRoles) {
        // Find agent config for this role (from any connected machine)
        const config = configsResult.configs.find(
          (c) => c.role.toLowerCase() === role && c.daemonConnected
        );

        if (!config) {
          // Try any config even if daemon isn't connected (it might come back)
          const anyConfig = configsResult.configs.find((c) => c.role.toLowerCase() === role);

          if (!anyConfig) {
            skipped.push(role);
            continue;
          }

          // Machine daemon is not connected — skip, can't restart
          skipped.push(role);
          continue;
        }

        try {
          // Stop the agent first (cleans up stale process)
          await sendCommand({
            machineId: config.machineId,
            type: 'stop-agent',
            payload: {
              chatroomId: chatroomId as Id<'chatroom_rooms'>,
              role: config.role,
            },
          });

          // Brief delay between stop and start
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Start the agent
          await sendCommand({
            machineId: config.machineId,
            type: 'start-agent',
            payload: {
              chatroomId: chatroomId as Id<'chatroom_rooms'>,
              role: config.role,
              model: config.model,
              agentHarness: config.agentType as AgentHarness,
              workingDir: config.workingDir,
            },
          });

          restarted.push(role);
        } catch (err) {
          console.error(`Failed to restart agent for role "${role}":`, err);
          skipped.push(role);
        }
      }

      const result: AutoRestartResult = { restarted, skipped };
      setLastResult(result);
      return result;
    } finally {
      setIsRestarting(false);
    }
  }, [readiness, configsResult, sendCommand, chatroomId]);

  return {
    /** Trigger restart of all offline agents */
    restartOfflineAgents,
    /** Whether a restart is currently in progress */
    isRestarting,
    /** Result of the last restart attempt */
    lastResult,
    /** Whether there are offline agents that could potentially be restarted */
    hasOfflineAgents: Boolean(
      readiness &&
        ((readiness.expiredRoles?.length ?? 0) > 0 || (readiness.missingRoles?.length ?? 0) > 0)
    ),
  };
}
