/**
 * Shared types for machine assigned-task queries.
 */

import type { Id } from '../../../../convex/_generated/dataModel';

export interface AssignedTaskAgentConfigView {
  role: string;
  machineId: string;
  agentHarness: string;
  model?: string;
  workingDir?: string;
  spawnedAgentPid?: number;
  desiredState?: string;
  circuitState?: string;
}

export interface AssignedTaskParticipantView {
  lastSeenAction: string | null;
  lastSeenAt: number | null;
  lastStatus: string | null;
}

/** Full view including task content — for one-shot action fetches. */
export interface AssignedTaskView {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: string;
  assignedTo: string | undefined;
  taskContent: string;
  updatedAt: number;
  createdAt: number;
  agentConfig: AssignedTaskAgentConfigView;
  participant?: AssignedTaskParticipantView;
}

/** Slim snapshot row for daemon working set (no task.content). */
export interface AssignedTaskSnapshotView {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: string;
  assignedTo: string | undefined;
  updatedAt: number;
  createdAt: number;
  agentConfig: AssignedTaskAgentConfigView;
  participant?: AssignedTaskParticipantView;
}

export interface ListMachineAssignedTaskSnapshotsResult {
  tasks: AssignedTaskSnapshotView[];
}

export type AssignedTaskSignalType = 'task' | 'agent_config';

export interface AssignedTaskSignal {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  status: 'pending' | 'acknowledged' | 'in_progress';
  signalType: AssignedTaskSignalType;
  /** Monotonic exclusive cursor component — excludes pure lastSeenAt heartbeats. */
  revisionKey: string;
  sessionAugmentation?: 'none' | 'compact' | 'new_session';
  lastSeenAction?: string | null;
  spawnedAgentPid?: number;
  desiredState?: string;
}

export interface AssignedTaskPresenceSignal {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  lastSeenAt: number | null;
  lastSeenAction?: string | null;
  presenceUpdatedAt: number;
}

export interface SubscribeAssignedTaskSignalsResult {
  items: AssignedTaskSignal[];
  highKey: string | null;
  hasMore: boolean;
}

export interface SubscribeAssignedTaskPresenceResult {
  items: AssignedTaskPresenceSignal[];
  highPresenceAt: number | null;
  hasMore: boolean;
}

export interface MachineAssignedTasksInput {
  machineId: string;
  userId: Id<'users'>;
}

export interface GetAssignedTaskForActionInput extends MachineAssignedTasksInput {
  taskId: Id<'chatroom_tasks'>;
  role: string;
}

export interface SubscribeAssignedTaskSignalsInput extends MachineAssignedTasksInput {
  afterKey?: string;
  limit: number;
}

export interface SubscribeAssignedTaskPresenceInput extends MachineAssignedTasksInput {
  afterPresenceAt: number;
  limit: number;
}
