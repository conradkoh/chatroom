/**
 * Shared types for machine assigned-task queries.
 *
 * Wire shapes (signal, presence, snapshot row) are defined in
 * assigned-task-monitor-contract.ts (Zod source of truth) and re-exported here.
 */
// fallow-ignore-file unused-type unused-export

import type { AssignedTaskSnapshotView } from './assigned-task-monitor-contract';
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
} from './assigned-task-monitor-contract';
export {
  ACTIVE_TASK_STATUSES,
  AGENT_CIRCUIT_STATES,
  AGENT_DESIRED_STATES,
  SESSION_AUGMENTATION_MODES,
  isAgentDesiredRunning,
  isDeliverableTaskStatus,
} from './assigned-task-monitor-contract';

/** Full view including task content — for one-shot action fetches. */
export interface AssignedTaskView extends AssignedTaskSnapshotView {
  taskContent: string;
  startInNewSession?: boolean;
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
