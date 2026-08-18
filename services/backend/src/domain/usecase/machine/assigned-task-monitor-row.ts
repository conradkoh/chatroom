/**
 * Canonical merge + projection helpers for daemon assigned-task monitor rows.
 * Pure functions — safe for CLI import.
 */

import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from './assigned-task-monitor-contract';
import { toAgentConfigView, toParticipantView } from './assigned-tasks-core';
import type { Doc } from '../../../../convex/_generated/dataModel';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type SnapshotDoc = Doc<'chatroom_machineAssignedTaskSnapshots'>;

function toOptional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function toNullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function mergeOptional<T>(incoming: T | null | undefined, existing: T | undefined): T | undefined {
  return incoming === null ? undefined : (incoming ?? existing);
}

function mergeNullable<T>(
  incoming: T | null | undefined,
  existing: T | null | undefined
): T | null {
  return incoming === null ? null : (incoming ?? existing ?? null);
}

/** Full row from projection doc (hydrate path). */
export function monitorRowFromSnapshotDoc(doc: SnapshotDoc): AssignedTaskSnapshotView {
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
    assignedTo: toOptional(signal.assignedTo),
    updatedAt: signal.updatedAt ?? signal.createdAt,
    createdAt: signal.createdAt,
    agentConfig: {
      role: signal.role,
      machineId: signal.machineId,
      agentHarness: signal.agentHarness,
      model: toOptional(signal.model),
      workingDir: toOptional(signal.workingDir),
      spawnedAgentPid: toOptional(signal.spawnedAgentPid),
      desiredState: toOptional(signal.desiredState),
      circuitState: toOptional(signal.circuitState),
    },
    participant: {
      lastSeenAction: toNullable(signal.lastSeenAction),
      lastSeenAt: null,
      lastStatus: toNullable(signal.lastStatus),
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
    assignedTo: mergeOptional(signal.assignedTo, existing.assignedTo),
    updatedAt: signal.updatedAt ?? existing.updatedAt,
    agentConfig: {
      ...existing.agentConfig,
      agentHarness: signal.agentHarness,
      model: mergeOptional(signal.model, existing.agentConfig.model),
      workingDir: mergeOptional(signal.workingDir, existing.agentConfig.workingDir),
      spawnedAgentPid: mergeOptional(signal.spawnedAgentPid, existing.agentConfig.spawnedAgentPid),
      desiredState: mergeOptional(signal.desiredState, existing.agentConfig.desiredState),
      circuitState: mergeOptional(signal.circuitState, existing.agentConfig.circuitState),
    },
    participant: {
      lastSeenAction: mergeNullable(signal.lastSeenAction, existing.participant?.lastSeenAction),
      lastSeenAt: existing.participant?.lastSeenAt ?? null,
      lastStatus: mergeNullable(signal.lastStatus, existing.participant?.lastStatus),
    },
  };
}

// fallow-ignore-next-line complexity
export function applyAssignedTaskPresence(
  existing: AssignedTaskSnapshotView | undefined,
  presence: AssignedTaskPresenceSignal
): AssignedTaskSnapshotView | undefined {
  if (!existing) return undefined;
  return {
    ...existing,
    participant: {
      lastSeenAction: presence.lastSeenAction ?? existing.participant?.lastSeenAction ?? null,
      lastSeenAt: presence.lastSeenAt ?? existing.participant?.lastSeenAt ?? null,
      lastStatus: existing.participant?.lastStatus ?? null,
    },
  };
}
