/**
 * Canonical merge + projection helpers for daemon assigned-task monitor rows.
 * Pure functions — safe for CLI import.
 */

import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from './assigned-task-snapshot-contract';
import { toAgentConfigView } from './assigned-tasks-core';
import type { Doc } from '../../../../convex/_generated/dataModel';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type SnapshotDoc = Doc<'chatroom_machineAssignedTaskSnapshots'>;

/** Full row from projection doc (hydrate path). */
export function assignedTaskSnapshotFromDoc(doc: SnapshotDoc): AssignedTaskSnapshotView {
  const configStub = {
    role: doc.role,
    machineId: doc.machineId,
    type: 'remote' as const,
    agentHarness: doc.agentHarness,
    model: doc.model,
    workingDir: doc.workingDir,
    teamRoleKey: '',
    chatroomId: doc.chatroomId,
    createdAt: 0,
    updatedAt: doc.configUpdatedAt,
  };
  return {
    taskId: doc.taskId,
    chatroomId: doc.chatroomId,
    status: doc.taskStatus,
    assignedTo: doc.taskAssignedTo,
    updatedAt: doc.taskUpdatedAt,
    createdAt: doc.taskCreatedAt,
    agentConfig: toAgentConfigView(configStub as RemoteAgentConfig, doc.machineId),
  };
}

/** Bootstrap or patch: always returns a row when signal is valid. */
export function applyAssignedTaskSignal(
  existing: AssignedTaskSnapshotView | undefined,
  signal: AssignedTaskSignal
): AssignedTaskSnapshotView {
  if (!existing) {
    return bootstrapMonitorRowFromSignal(signal);
  }
  return patchMonitorRowFromSignal(existing, signal);
}

function bootstrapMonitorRowFromSignal(signal: AssignedTaskSignal): AssignedTaskSnapshotView {
  return {
    taskId: signal.taskId,
    chatroomId: signal.chatroomId,
    status: signal.status,
    assignedTo: signal.assignedTo,
    updatedAt: signal.createdAt,
    createdAt: signal.createdAt,
    agentConfig: {
      role: signal.role,
      machineId: signal.machineId,
      agentHarness: signal.agentHarness,
      workingDir: signal.workingDir,
    },
  };
}

// fallow-ignore-next-line complexity
function patchMonitorRowFromSignal(
  existing: AssignedTaskSnapshotView,
  signal: AssignedTaskSignal
): AssignedTaskSnapshotView {
  return {
    ...existing,
    status: signal.status,
    agentConfig: {
      ...existing.agentConfig,
    },
  };
}

// fallow-ignore-next-line complexity
export function applyAssignedTaskPresence(
  existing: AssignedTaskSnapshotView | undefined,
  _presence: AssignedTaskPresenceSignal
): AssignedTaskSnapshotView | undefined {
  return existing;
}
