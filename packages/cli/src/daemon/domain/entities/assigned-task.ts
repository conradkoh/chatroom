import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

export const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;
export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

export const AGENT_DESIRED_STATES = ['running', 'stopped'] as const;
export type AgentDesiredState = (typeof AGENT_DESIRED_STATES)[number];

export const AGENT_CIRCUIT_STATES = ['closed', 'open', 'half-open'] as const;
export type AgentCircuitState = (typeof AGENT_CIRCUIT_STATES)[number];

export interface AssignedTaskAgentConfig {
  role: string;
  machineId: string;
  agentHarness: string;
  model?: string | undefined;
  workingDir?: string | undefined;
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
  participant?: AssignedTaskParticipant | undefined;
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
