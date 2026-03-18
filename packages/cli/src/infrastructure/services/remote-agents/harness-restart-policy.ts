/**
 * HarnessRestartPolicy — per-harness logic for deciding when to restart an agent.
 *
 * Each harness (OpenCode, Pi) has different capabilities:
 * - OpenCode: No agent_end signal → use immediate-start logic
 * - Pi: Supports agent_end → only restart after the agent has ended its turn
 *
 * The daemon's task monitor uses these policies to decide when to spawn
 * a fresh agent for an assigned task.
 */

import type { Id } from '../../../api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Task info returned by getAssignedTasks query. */
export interface TaskInfo {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: string;
  assignedTo: string | undefined;
  updatedAt: number;
  createdAt: number;
}

/** Agent config info returned by getAssignedTasks query. */
export interface AgentConfigInfo {
  role: string;
  machineId: string;
  agentHarness: string;
  model?: string;
  workingDir?: string;
  spawnedAgentPid?: number;
  desiredState?: string;
  circuitState?: string;
}

/** Parameters for shouldStartAgent decision. */
export interface ShouldStartAgentParams {
  task: TaskInfo;
  agentConfig: AgentConfigInfo;
}

/**
 * Context for agent-ended-turn tracking (used by Pi policy).
 * The daemon maintains this state in memory, keyed by `${chatroomId}:${role}`.
 */
export interface AgentEndContext {
  /** Map of chatroomId:role → whether the agent has ended its turn. */
  agentEndedTurn: Map<string, boolean>;
}

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Policy for deciding when to start/restart an agent.
 * Each harness implements this interface with its own restart logic.
 */
export interface HarnessRestartPolicy {
  /** Harness identifier (e.g., 'opencode', 'pi'). */
  readonly id: string;

  /**
   * Returns true if the daemon should start/restart the agent now.
   *
   * @param params Task and config info for the decision
   * @param context Optional context for cross-call state (e.g., agent-ended-turn tracking)
   * @returns true if the agent should be started
   */
  shouldStartAgent(
    params: ShouldStartAgentParams,
    context?: AgentEndContext
  ): boolean;
}

// ─── OpenCode Policy ──────────────────────────────────────────────────────────

/**
 * OpenCode restart policy.
 *
 * OpenCode doesn't have an agent_end signal, so we use immediate-start logic:
 * - in_progress + dead agent (spawnedAgentPid == null):
 *   Restart immediately if desiredState='running' and circuitState != 'open'
 * - pending/acknowledged + no agent (spawnedAgentPid == null):
 *   Restart immediately if desiredState='running' and circuitState != 'open'
 */
export class OpenCodeRestartPolicy implements HarnessRestartPolicy {
  readonly id = 'opencode';

  shouldStartAgent(params: ShouldStartAgentParams): boolean {
    const { task, agentConfig } = params;

    // Skip if not desired to run
    if (agentConfig.desiredState !== 'running') {
      return false;
    }

    // Skip if circuit breaker is open
    if (agentConfig.circuitState === 'open') {
      return false;
    }

    // Case 1: in_progress task with dead agent (no PID)
    // The agent was working on this task but died (process crashed/exited)
    // Restart the agent to continue working
    if (task.status === 'in_progress') {
      return agentConfig.spawnedAgentPid == null;
    }

    // Case 2: pending/acknowledged task with no running agent
    // No need to wait; if there's no PID, start right away.
    if (task.status === 'pending' || task.status === 'acknowledged') {
      return agentConfig.spawnedAgentPid == null;
    }

    // All other statuses: don't restart
    return false;
  }
}

// ─── Pi Policy ────────────────────────────────────────────────────────────────

/**
 * Pi restart policy.
 *
 * Pi agents signal when they've ended their turn (agent_end event).
 *
 * Restart conditions:
 * - in_progress + dead agent (spawnedAgentPid == null):
 *   Restart immediately if desiredState='running', circuitState != 'open'
 * - pending/acknowledged + no agent (spawnedAgentPid == null):
 *   Restart immediately if desiredState='running', circuitState != 'open'
 * - pending/acknowledged + agent has ended turn:
 *   Restart if desiredState='running', circuitState != 'open'
 *
 * This prevents interrupting an active Pi agent mid-turn.
 */
export class PiRestartPolicy implements HarnessRestartPolicy {
  readonly id = 'pi';

  shouldStartAgent(
    params: ShouldStartAgentParams,
    context?: AgentEndContext
  ): boolean {
    const { task, agentConfig } = params;

    // Skip if not desired to run
    if (agentConfig.desiredState !== 'running') {
      return false;
    }

    // Skip if circuit breaker is open
    if (agentConfig.circuitState === 'open') {
      return false;
    }

    // Case 1: in_progress task with dead agent (no PID)
    // The agent was working on this task but died (process crashed/exited)
    // Restart the agent to continue working
    if (task.status === 'in_progress') {
      return agentConfig.spawnedAgentPid == null;
    }

    // Case 2: pending/acknowledged task with no running agent
    // No need to wait for agent_end signal; if there's no PID, start right away.
    if (task.status === 'pending' || task.status === 'acknowledged') {
      if (agentConfig.spawnedAgentPid == null) {
        return true; // immediate start
      }
    }

    // Case 3: pending/acknowledged with PID — wait for agent_end signal
    if (task.status !== 'pending' && task.status !== 'acknowledged') {
      return false;
    }

    // CRITICAL: Only restart if the agent has ended its turn
    // This is tracked in the daemon's memory via onAgentEnd callback
    if (!context?.agentEndedTurn) {
      return false;
    }

    const key = `${task.chatroomId}:${agentConfig.role}`;
    const hasEndedTurn = context.agentEndedTurn.get(key);

    // Only start if the agent has explicitly ended its turn
    return hasEndedTurn === true;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the restart policy for a given harness.
 * Falls back to a conservative default policy (always returns false) for unknown harnesses.
 */
export function getRestartPolicyForHarness(harness: string): HarnessRestartPolicy {
  switch (harness) {
    case 'opencode':
      return new OpenCodeRestartPolicy();
    case 'pi':
      return new PiRestartPolicy();
    default:
      // Default policy: never restart (conservative fallback)
      return {
        id: harness,
        shouldStartAgent: () => false,
      };
  }
}