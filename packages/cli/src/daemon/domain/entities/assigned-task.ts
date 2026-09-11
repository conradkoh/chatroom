import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

export { AgentRoleLifecycleTag as TaskAssigneeType } from '@workspace/shared/domain/agent-role';

export const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;
export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

export const AGENT_DESIRED_STATES = ['running', 'stopped'] as const;
export type AgentDesiredState = (typeof AGENT_DESIRED_STATES)[number];

export const AGENT_CIRCUIT_STATES = ['closed', 'open', 'half-open'] as const;
export type AgentCircuitState = (typeof AGENT_CIRCUIT_STATES)[number];

export interface EphemeralAgentConfig {
  agentHarness: string;
  model: string;
  workingDir: string;
}

export type TaskAssignee =
  | { type: AgentRoleLifecycleTag.Permanent }
  | { type: AgentRoleLifecycleTag.Ephemeral; ephemeral: EphemeralAgentConfig };

export interface AgentRuntimeConfig {
  agentHarness: string;
  model?: string | undefined;
  workingDir: string;
}

export interface AssignedTaskAgentConfig {
  role: string;
  machineId: string;
  spawnedAgentPid?: number | undefined;
  desiredState?: AgentDesiredState | undefined;
  circuitState?: AgentCircuitState | undefined;
  configLifecycleRevision?: number | undefined;
}

export interface AssignedTaskParticipant {
  lastSeenAction: string | null;
  lastSeenAt: number | null;
  lastStatus: string | null;
}

/** Daemon working-row snapshot for assigned tasks (SSOT). */
export interface AssignedTask {
  taskId: string;
  chatroomId: string;
  status: ActiveTaskStatus;
  assignedTo: string | undefined;
  updatedAt: number;
  createdAt: number;
  agentConfig: AssignedTaskAgentConfig;
  assignee?: TaskAssignee | undefined;
  participant?: AssignedTaskParticipant | undefined;
  /** Explicit native cold-restart intent projected at write time. */
  requestsNativeColdSession?: boolean | undefined;
}

// fallow-ignore-next-line complexity
export function resolveAgentRuntimeConfig(
  task: AssignedTask,
  slot?: {
    harness?: string | undefined;
    model?: string | undefined;
    workingDir?: string | undefined;
  }
): AgentRuntimeConfig | undefined {
  if (task.assignee?.type === AgentRoleLifecycleTag.Ephemeral) return task.assignee.ephemeral;
  if (!slot?.harness || !slot.workingDir) return undefined;
  return { agentHarness: slot.harness, model: slot.model, workingDir: slot.workingDir };
}

export function isDeliverableTaskStatus(status: ActiveTaskStatus): boolean {
  return status === 'pending' || status === 'acknowledged';
}

export function isAgentDesiredRunning(desiredState: AgentDesiredState | undefined): boolean {
  return desiredState === 'running';
}

/** Gradual migration alias — structurally identical to backend AssignedTaskSnapshotView. */
export type AssignedTaskSnapshotView = AssignedTask;

/** Full task view including content — for one-shot action fetches. */
export interface AssignedTaskWithContent extends AssignedTask {
  taskContent: string;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  startInNewSession?: boolean | undefined;
}
