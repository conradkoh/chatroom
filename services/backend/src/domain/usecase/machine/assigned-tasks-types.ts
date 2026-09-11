/**
 * Shared types for machine assigned-task queries.
 *
 * Task and action-view wire shapes are defined in
 * assigned-task-contract.ts (Zod source of truth) and re-exported here.
 */
// fallow-ignore-file unused-type unused-export

import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import type { AssignedTask } from './assigned-task-contract';
import type { Id } from '../../../../convex/_generated/dataModel';

export type {
  ActiveTaskStatus,
  AgentCircuitState,
  AgentDesiredState,
  AssignedTaskAgentConfigView,
  AssignedTaskParticipantView,
  AssignedTaskPresenceDelta,
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSignalType,
  AssignedTask,
  EphemeralAgentConfig,
  SessionAugmentationMode,
} from './assigned-task-contract';
export {
  ACTIVE_TASK_STATUSES,
  AGENT_CIRCUIT_STATES,
  AGENT_DESIRED_STATES,
  SESSION_AUGMENTATION_MODES,
  isAgentDesiredRunning,
  isDeliverableTaskStatus,
} from './assigned-task-contract';

/** Full view including task content — for one-shot action fetches. */
export interface AssignedTaskView extends AssignedTask {
  taskContent: string;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  startInNewSession?: boolean | undefined;
}

export interface MachineAssignedTasksInput {
  machineId: string;
  userId: Id<'users'>;
}

export interface GetAssignedTaskForActionInput extends MachineAssignedTasksInput {
  taskId: Id<'chatroom_tasks'>;
  role: string;
}
