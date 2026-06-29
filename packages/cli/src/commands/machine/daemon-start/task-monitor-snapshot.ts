/**
 * Task-monitor working snapshot — domain merge rules over shared WorkingSnapshot.
 */

import type {
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import { WorkingSnapshot } from '../../../infrastructure/incremental-sync/working-snapshot.js';

function taskSnapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}

/** Merge incremental signal fields into a reconcile snapshot row. */
// fallow-ignore-next-line complexity
function mergeSignalIntoSnapshot(
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

export class TaskMonitorSnapshot {
  private readonly inner = new WorkingSnapshot<AssignedTaskSnapshotView, AssignedTaskSignal>({
    rowKey: (row) => taskSnapshotKey(row.taskId, row.agentConfig.role),
    signalKey: (signal) => taskSnapshotKey(signal.taskId, signal.role),
    mergeSignal: mergeSignalIntoSnapshot,
  });

  replaceAll(tasks: readonly AssignedTaskSnapshotView[]): void {
    this.inner.replaceAll(tasks);
  }

  get(taskId: string, role: string): AssignedTaskSnapshotView | undefined {
    return this.inner.getByKey(taskSnapshotKey(taskId, role));
  }

  mergeSignal(signal: AssignedTaskSignal): AssignedTaskSnapshotView | undefined {
    return this.inner.mergeSignal(signal);
  }
}
