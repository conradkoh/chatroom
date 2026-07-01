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

/** Merge incremental signal fields into a reconcile snapshot row.
 *
 * When the daemon sees a task for the first time (existing is undefined), it
 * must construct a row from the signal data rather than dropping the signal.
 * This is required because the incremental subscription replaces the old polling
 * mechanism — without this, tasks created while the daemon is running are
 * silently lost, stuck in 'pending' forever.
 *
 * The signal carries enough fields (agentHarness, workingDir, assignedTo,
 * createdAt) to build a usable row. The daemon fetches full details from the
 * backend only when it needs to act (nudge, inject, revive). */
// fallow-ignore-next-line complexity
function mergeSignalIntoTaskSnapshot(
  existing: AssignedTaskSnapshotView | undefined,
  signal: AssignedTaskSignal
): AssignedTaskSnapshotView | undefined {
  if (!existing) {
    // New task discovered via signal — build a minimal row from signal data.
    // The daemon will fetch full details from the backend when it acts.
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
