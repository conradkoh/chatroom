import type { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

export { AgentRoleLifecycleTag as TaskAssigneeType } from '@workspace/shared/domain/agent-role';

export const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;
export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

export interface EphemeralAgentConfig {
  agentHarness: string;
  model: string;
  workingDir: string;
}

export type TaskAssignee =
  | { type: AgentRoleLifecycleTag.Permanent }
  | { type: AgentRoleLifecycleTag.Ephemeral; ephemeral: EphemeralAgentConfig };

export interface AssignedTaskAgentConfig {
  role: string;
  machineId: string;
}

export interface AssignedTaskParticipant {
  lastSeenAction: string | null;
  lastSeenAt: number | null;
}

/** Task inbox view used by the daemon task service. */
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

export function isDeliverableTaskStatus(status: ActiveTaskStatus): boolean {
  return status === 'pending' || status === 'acknowledged';
}

/** Full task view including content — for one-shot action fetches. */
export interface AssignedTaskWithContent extends AssignedTask {
  taskContent: string;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  startInNewSession?: boolean | undefined;
}
