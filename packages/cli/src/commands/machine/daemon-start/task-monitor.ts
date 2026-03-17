/**
 * Task Monitor — subscribes to assigned tasks and starts agents as needed.
 *
 * The daemon uses this module to monitor all tasks assigned to roles on this machine.
 * When a task needs an agent (pending/acknowledged, idle, circuit breaker closed),
 * the task monitor invokes the harness-specific restart policy to decide if
 * it should start/restart the agent.
 *
 * This replaces the backend's ensureAgentHandler as the primary restart mechanism,
 * with the backend's scheduled fallback acting only as a safety net for when
 * the daemon is completely offline.
 */

import { api } from '../../../api.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import {
  getRestartPolicyForHarness,
  type AgentEndContext,
} from '../../../infrastructure/services/remote-agents/harness-restart-policy.js';
import { executeStartAgent } from './handlers/start-agent.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Minimum time between restart attempts for the same (chatroomId, role).
 * Prevents rapid-fire restarts when something goes wrong.
 */
const RESTART_COOLDOWN_MS = 60_000; // 1 minute

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Tracks the last restart attempt time per (chatroomId, role).
 * Used to prevent rapid-fire restarts.
 */
const lastRestartAttempt = new Map<string, number>();

/**
 * Returns true if enough time has passed since the last restart attempt
 * for this (chatroomId, role).
 */
function canAttemptRestart(chatroomId: string, role: string, now: number): boolean {
  const key = `${chatroomId}:${role.toLowerCase()}`;
  const lastAttempt = lastRestartAttempt.get(key) ?? 0;
  return now - lastAttempt >= RESTART_COOLDOWN_MS;
}

/**
 * Record a restart attempt for rate limiting.
 */
function recordRestartAttempt(chatroomId: string, role: string, now: number): void {
  const key = `${chatroomId}:${role.toLowerCase()}`;
  lastRestartAttempt.set(key, now);
}

// ─── Task Monitor ────────────────────────────────────────────────────────────

/**
 * Start the task monitor: subscribe to getAssignedTasks and start agents
 * when the harness-specific restart policy allows.
 */
export function startTaskMonitor(ctx: DaemonContext): { stop: () => void } {
  let unsubscribe: (() => void) | null = null;
  let isRunning = true;

  const startMonitoring = async () => {
    try {
      const wsClient = await getConvexWsClient();

      // Agent end context for PiRestartPolicy
      const agentEndContext: AgentEndContext = {
        agentEndedTurn: ctx.agentEndedTurn,
      };

      // Subscribe to assigned tasks for this machine
      unsubscribe = wsClient.onUpdate(
        api.machines.getAssignedTasks,
        {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
        },
        async (result) => {
          if (!result?.tasks || result.tasks.length === 0) return;

          const now = Date.now();

          for (const taskInfo of result.tasks) {
            const { task, agentConfig, lastTokenAt } = {
              task: {
                taskId: taskInfo.taskId,
                chatroomId: taskInfo.chatroomId,
                status: taskInfo.status,
                assignedTo: taskInfo.assignedTo,
                updatedAt: taskInfo.updatedAt,
                createdAt: taskInfo.createdAt,
              },
              agentConfig: taskInfo.agentConfig,
              lastTokenAt: taskInfo.lastSeenTokenAt,
            };

            // Get the restart policy for this harness
            const policy = getRestartPolicyForHarness(agentConfig.agentHarness);

            // Check if we should start an agent
            const shouldStart = policy.shouldStartAgent(
              { task, agentConfig, lastTokenAt, now },
              agentEndContext
            );

            if (!shouldStart) continue;

            // Rate limit: don't restart more than once per minute per (chatroomId, role)
            if (!canAttemptRestart(task.chatroomId, agentConfig.role, now)) {
              continue;
            }

            // Check if agent is already running (has a spawned PID)
            if (agentConfig.spawnedAgentPid != null) {
              // Agent might still be running, but hasn't produced tokens
              // Let the process monitor handle it
              continue;
            }

            // Required fields for starting agent
            if (!agentConfig.workingDir) {
              console.warn(
                `[${formatTimestamp()}] ⚠️  Missing workingDir for ${task.chatroomId}/${agentConfig.role}` +
                  ` — skipping`
              );
              continue;
            }

            console.log(
              `[${formatTimestamp()}] 📡 Task monitor: starting agent for ` +
                `${task.chatroomId}/${agentConfig.role} (harness: ${agentConfig.agentHarness})`
            );

            // Record the attempt for rate limiting
            recordRestartAttempt(task.chatroomId, agentConfig.role, now);

            // Execute the start-agent logic
            try {
              await executeStartAgent(ctx, {
                chatroomId: task.chatroomId,
                role: agentConfig.role,
                agentHarness: agentConfig.agentHarness as 'opencode' | 'pi' | 'cursor',
                model: agentConfig.model,
                workingDir: agentConfig.workingDir,
                reason: 'daemon.task_monitor',
              });
            } catch (err) {
              console.error(
                `[${formatTimestamp()}] ❌ Task monitor failed to start agent ` +
                  `for ${task.chatroomId}/${agentConfig.role}: ${(err as Error).message}`
              );
            }
          }
        }
      );

      console.log(`[${formatTimestamp()}] 🔍 Task monitor started`);
    } catch (err) {
      if (isRunning) {
        console.error(
          `[${formatTimestamp()}] ❌ Task monitor error: ${(err as Error).message}`
        );
        // Retry after a delay
        setTimeout(startMonitoring, 5000);
      }
    }
  };

  startMonitoring();

  return {
    stop: () => {
      isRunning = false;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };
}