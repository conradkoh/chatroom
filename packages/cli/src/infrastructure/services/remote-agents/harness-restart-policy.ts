/**
 * HarnessRestartPolicy — per-harness logic for deciding when to restart an agent.
 *
 * Each harness (OpenCode, Pi) has different capabilities:
 * - OpenCode: No agent_end signal → use stuck detection (task timeout + idle)
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
  lastTokenAt: number | null;
  now: number;
}

/**
 * Context for agent-ended-turn tracking (used by Pi policy).
 * The daemon maintains this state in memory, keyed by `${chatroomId}:${role}`.
 */
export interface AgentEndContext {
  /** Map of chatroomId:role → whether the agent has ended its turn. */
  agentEndedTurn: Map<string, boolean>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * How long a task can be in pending/acknowledged before we consider it stuck.
 * Must be >= STUCK_TOKEN_THRESHOLD_MS (5 minutes) to align with backend logic.
 */
const STUCK_TASK_THRESHOLD_MS = 300_000; // 5 minutes

/**
 * How long an agent can go without producing tokens before we consider it idle.
 * OpenCode uses this to determine if the agent is truly stuck vs. just slow.
 */
const IDLE_TOKEN_THRESHOLD_MS = 60_000; // 1 minute

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
   * @param params Task, config, and timing info for the decision
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
 * OpenCode doesn't have an agent_end signal, so we rely on stuck detection:
 * - Task is in pending/acknowledged for > STUCK_TASK_THRESHOLD_MS
 * - AND the agent has not produced tokens in > IDLE_TOKEN_THRESHOLD_MS
 * - AND desiredState is 'running'
 * - AND circuit breaker is not 'open'
 */
export class OpenCodeRestartPolicy implements HarnessRestartPolicy {
  readonly id = 'opencode';

  shouldStartAgent(params: ShouldStartAgentParams): boolean {
    const { task, agentConfig, lastTokenAt, now } = params;

    // Skip if not desired to run
    if (agentConfig.desiredState !== 'running') {
      return false;
    }

    // Skip if circuit breaker is open
    if (agentConfig.circuitState === 'open') {
      return false;
    }

    // Only restart for pending or acknowledged tasks
    // (in_progress means the agent is actively working)
    if (task.status !== 'pending' && task.status !== 'acknowledged') {
      return false;
    }

    // Check if task has been stuck long enough
    const taskAge = now - task.createdAt;
    const timeSinceUpdate = now - task.updatedAt;

    // Task must be older than threshold
    if (taskAge < STUCK_TASK_THRESHOLD_MS && timeSinceUpdate < STUCK_TASK_THRESHOLD_MS) {
      return false;
    }

    // Check if agent is idle (no tokens recently)
    // If lastTokenAt is null, the agent has never produced output → idle
    // If lastTokenAt is old, the agent stopped producing → idle
    const isIdle =
      lastTokenAt === null || now - lastTokenAt > IDLE_TOKEN_THRESHOLD_MS;

    return isIdle;
  }
}

// ─── Pi Policy ────────────────────────────────────────────────────────────────

/**
 * Pi restart policy.
 *
 * Pi agents signal when they've ended their turn (agent_end event).
 * We only restart when:
 * - Task is in pending/acknowledged
 * - desiredState is 'running'
 * - circuit breaker is not 'open'
 * - The agent has ended its turn (tracked in AgentEndContext)
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

    // Only restart for pending or acknowledged tasks
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