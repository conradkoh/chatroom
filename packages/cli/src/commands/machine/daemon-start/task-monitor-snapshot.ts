/**
 * Task-monitor working snapshot — domain merge rules over shared WorkingSnapshot.
 */

import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  WorkingSnapshot,
  type WorkingSnapshotOptions,
} from '../../../infrastructure/incremental-sync/working-snapshot.js';

function taskSnapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}

/** Merge incremental signal fields into a reconcile snapshot row. */
// fallow-ignore-next-line complexity
function mergeSignalIntoTaskSnapshot(
  existing: AssignedTaskSnapshotView | undefined,
  signal: AssignedTaskSignal
): AssignedTaskSnapshotView | undefined {
  if (!existing) {
    return undefined;
  }

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

/** Merge incremental presence fields (lastSeenAt) into a snapshot row. */
// fallow-ignore-next-line complexity
function mergePresenceIntoTaskSnapshot(
  existing: AssignedTaskSnapshotView | undefined,
  presence: AssignedTaskPresenceSignal
): AssignedTaskSnapshotView | undefined {
  if (!existing) {
    return undefined;
  }
  return {
    ...existing,
    participant: {
      lastSeenAction: presence.lastSeenAction ?? existing.participant?.lastSeenAction ?? null,
      lastSeenAt: presence.lastSeenAt,
      lastStatus: existing.participant?.lastStatus ?? null,
    },
  };
}

const taskMonitorSnapshotOptions: WorkingSnapshotOptions<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> = {
  rowKey: (row) => taskSnapshotKey(row.taskId, row.agentConfig.role),
  signalKey: (signal) => taskSnapshotKey(signal.taskId, signal.role),
  mergeSignal: mergeSignalIntoTaskSnapshot,
};

export function createTaskMonitorSnapshot(): WorkingSnapshot<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> & {
  mergePresence(presence: AssignedTaskPresenceSignal): AssignedTaskSnapshotView | undefined;
} {
  const base = new WorkingSnapshot(taskMonitorSnapshotOptions);
  return Object.assign(base, {
    mergePresence(presence: AssignedTaskPresenceSignal) {
      const key = taskSnapshotKey(presence.taskId, presence.role);
      const existing = base.getByKey(key);
      const merged = mergePresenceIntoTaskSnapshot(existing, presence);
      if (merged) {
        base.upsertRow(merged);
      }
      return merged;
    },
  });
}
