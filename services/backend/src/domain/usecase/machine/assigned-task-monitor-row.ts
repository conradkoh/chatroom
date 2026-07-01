/**
 * Canonical merge + projection helpers for daemon assigned-task monitor rows.
 * Pure functions — safe for CLI import.
 */

import { toAgentConfigView, toParticipantView } from './assigned-tasks-core';
import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from './assigned-tasks-types';
import type { Doc } from '../../../../convex/_generated/dataModel';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type SnapshotDoc = Doc<'chatroom_machineAssignedTaskSnapshots'>;

export type AssignedTaskMonitorRow = AssignedTaskSnapshotView;

/** Full row from projection doc (hydrate path). */
export function monitorRowFromSnapshotDoc(doc: SnapshotDoc): AssignedTaskMonitorRow {
  const configStub = {
    role: doc.role,
    machineId: doc.machineId,
    type: 'remote' as const,
    agentHarness: doc.agentHarness,
    model: doc.model,
    workingDir: doc.workingDir,
    spawnedAgentPid: doc.spawnedAgentPid,
    desiredState: doc.desiredState,
    circuitState: doc.circuitState,
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
    participant: toParticipantView({
      lastSeenAction: doc.lastSeenAction,
      lastSeenAt: doc.lastSeenAt,
      lastStatus: doc.lastStatus,
    } as Doc<'chatroom_participants'>) ?? {
      lastSeenAction: null,
      lastSeenAt: null,
      lastStatus: null,
    },
  };
}

/** Bootstrap or patch: always returns a row when signal is valid. */
export function applyAssignedTaskSignal(
  existing: AssignedTaskMonitorRow | undefined,
  signal: AssignedTaskSignal
): AssignedTaskMonitorRow {
  if (!existing) {
    return bootstrapMonitorRowFromSignal(signal);
  }
  return patchMonitorRowFromSignal(existing, signal);
}

function bootstrapMonitorRowFromSignal(signal: AssignedTaskSignal): AssignedTaskMonitorRow {
  return {
    taskId: signal.taskId,
    chatroomId: signal.chatroomId,
    status: signal.status,
    assignedTo: signal.assignedTo,
    updatedAt: signal.createdAt,
    createdAt: signal.createdAt,
    agentConfig: {
      role: signal.role,
      machineId: '',
      agentHarness: signal.agentHarness,
      workingDir: signal.workingDir,
      spawnedAgentPid: signal.spawnedAgentPid,
      desiredState: signal.desiredState,
    },
    participant: {
      lastSeenAction: signal.lastSeenAction ?? null,
      lastSeenAt: null,
      lastStatus: null,
    },
  };
}

// fallow-ignore-next-line complexity
function patchMonitorRowFromSignal(
  existing: AssignedTaskMonitorRow,
  signal: AssignedTaskSignal
): AssignedTaskMonitorRow {
  return {
    ...existing,
    status: signal.status,
    agentConfig: {
      ...existing.agentConfig,
      spawnedAgentPid: signal.spawnedAgentPid ?? existing.agentConfig.spawnedAgentPid,
      desiredState: signal.desiredState ?? existing.agentConfig.desiredState,
    },
    participant: {
      lastSeenAction: signal.lastSeenAction ?? existing.participant?.lastSeenAction ?? null,
      lastSeenAt: existing.participant?.lastSeenAt ?? null,
      lastStatus: existing.participant?.lastStatus ?? null,
    },
  };
}

// fallow-ignore-next-line complexity
export function applyAssignedTaskPresence(
  existing: AssignedTaskMonitorRow | undefined,
  presence: AssignedTaskPresenceSignal
): AssignedTaskMonitorRow | undefined {
  if (!existing) return undefined;
  return {
    ...existing,
    participant: {
      lastSeenAction: presence.lastSeenAction ?? existing.participant?.lastSeenAction ?? null,
      lastSeenAt: presence.lastSeenAt,
      lastStatus: existing.participant?.lastStatus ?? null,
    },
  };
}
