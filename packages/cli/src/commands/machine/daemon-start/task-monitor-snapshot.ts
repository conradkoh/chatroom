/**
 * In-memory working snapshot for task-monitor — merged from reconcile polls and signals.
 * Not durable; reconcile poll re-authorizes from Convex every interval.
 */

import type {
  AssignedTaskLiteView,
  AssignedTaskSignal,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

function taskSnapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}

/** Merge signal fields into an existing lite row. Returns undefined when no base row exists. */
// fallow-ignore-next-line complexity
function mergeSignalIntoLite(
  existing: AssignedTaskLiteView | undefined,
  signal: AssignedTaskSignal
): AssignedTaskLiteView | undefined {
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
  private readonly rows = new Map<string, AssignedTaskLiteView>();

  replaceAll(tasks: readonly AssignedTaskLiteView[]): void {
    this.rows.clear();
    for (const task of tasks) {
      this.rows.set(taskSnapshotKey(task.taskId, task.agentConfig.role), task);
    }
  }

  get(taskId: string, role: string): AssignedTaskLiteView | undefined {
    return this.rows.get(taskSnapshotKey(taskId, role));
  }

  mergeSignal(signal: AssignedTaskSignal): AssignedTaskLiteView | undefined {
    const key = taskSnapshotKey(signal.taskId, signal.role);
    const merged = mergeSignalIntoLite(this.rows.get(key), signal);
    if (!merged) {
      return undefined;
    }
    this.rows.set(key, merged);
    return merged;
  }
}
