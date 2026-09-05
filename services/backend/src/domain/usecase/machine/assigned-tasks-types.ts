/**
 * Shared types for machine assigned-task queries.
 *
 * Wire shapes (signal, presence, snapshot row) are defined in
 * assigned-task-snapshot-contract.ts (Zod source of truth) and re-exported here.
 */
// fallow-ignore-file unused-type unused-export

import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import type { AssignedTaskSnapshotView } from './assigned-task-snapshot-contract';
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
  AssignedTaskSnapshotView,
  SessionAugmentationMode,
} from './assigned-task-snapshot-contract';
export {
  ACTIVE_TASK_STATUSES,
  AGENT_CIRCUIT_STATES,
  AGENT_DESIRED_STATES,
  SESSION_AUGMENTATION_MODES,
  isAgentDesiredRunning,
  isDeliverableTaskStatus,
} from './assigned-task-snapshot-contract';

/** Full view including task content — for one-shot action fetches. */
export interface AssignedTaskView extends AssignedTaskSnapshotView {
  taskContent: string;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  startInNewSession?: boolean | undefined;
}

export interface ListMachineAssignedTaskSnapshotsResult {
  tasks: AssignedTaskSnapshotView[];
}

export interface MachineAssignedTasksInput {
  machineId: string;
  userId: Id<'users'>;
}

export interface GetAssignedTaskForActionInput extends MachineAssignedTasksInput {
  taskId: Id<'chatroom_tasks'>;
  role: string;
}
