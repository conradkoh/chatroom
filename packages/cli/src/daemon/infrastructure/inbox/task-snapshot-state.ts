// fallow-ignore-file unused-class-member
import type { TaskStatusSignal } from './task.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';

function snapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role.toLowerCase()}`;
}

/**
 * In-memory task read model owned by the machine task inbox.
 *
 * The inbox is the only component that mutates this state. Consumers such as
 * idle delivery read from it instead of rehydrating the full machine snapshot
 * projection from Convex.
 */
export class MachineTaskSnapshotState {
  private readonly snapshots = new Map<string, AssignedTaskSnapshotView>();

  replace(snapshots: readonly AssignedTaskSnapshotView[]): void {
    this.snapshots.clear();
    this.upsert(snapshots);
  }

  applySignalPage(
    signals: readonly TaskStatusSignal[],
    snapshots: readonly AssignedTaskSnapshotView[]
  ): void {
    const snapshotsByKey = new Map(
      snapshots.map((snapshot) => [
        snapshotKey(snapshot.taskId, snapshot.agentConfig.role),
        snapshot,
      ])
    );

    for (const signal of signals) {
      const key = snapshotKey(signal.taskId, signal.targetRole);
      const snapshot = snapshotsByKey.get(key);
      if (snapshot) {
        this.snapshots.set(key, snapshot);
      } else {
        // The projection intentionally contains active tasks only. A missing
        // row therefore means the task was completed, deleted, or reassigned.
        this.snapshots.delete(key);
      }
    }
  }

  listForRole(chatroomId: string, role: string): AssignedTaskSnapshotView[] {
    const roleLower = role.toLowerCase();
    return [...this.snapshots.values()].filter(
      (snapshot) =>
        snapshot.chatroomId === chatroomId && snapshot.agentConfig.role.toLowerCase() === roleLower
    );
  }

  listAll(): AssignedTaskSnapshotView[] {
    return [...this.snapshots.values()];
  }

  setDesiredState(chatroomId: string, role: string, desiredState: 'running' | 'stopped'): void {
    const roleLower = role.toLowerCase();
    for (const [key, snapshot] of this.snapshots) {
      if (
        snapshot.chatroomId !== chatroomId ||
        snapshot.agentConfig.role.toLowerCase() !== roleLower
      ) {
        continue;
      }
      this.snapshots.set(key, {
        ...snapshot,
        agentConfig: { ...snapshot.agentConfig, desiredState },
      });
    }
  }

  upsert(snapshots: readonly AssignedTaskSnapshotView[]): void {
    for (const snapshot of snapshots) {
      this.snapshots.set(snapshotKey(snapshot.taskId, snapshot.agentConfig.role), snapshot);
    }
  }
}
