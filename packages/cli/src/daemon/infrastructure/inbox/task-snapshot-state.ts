// fallow-ignore-file unused-class-member
import type { ChatroomRole } from '@workspace/shared/domain/chatroom-role';

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
  private initialized = false;

  replace(snapshots: readonly AssignedTaskSnapshotView[]): void {
    this.snapshots.clear();
    this.upsert(snapshots);
    this.initialized = true;
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

  listForRole(chatroomId: string, role: ChatroomRole): AssignedTaskSnapshotView[] {
    const roleLower = role.toLowerCase();
    return [...this.snapshots.values()].filter(
      (snapshot) =>
        snapshot.chatroomId === chatroomId && snapshot.agentConfig.role.toLowerCase() === roleLower
    );
  }

  /** Whether the initial machine snapshot has been loaded successfully. */
  isInitialized(): boolean {
    return this.initialized;
  }

  getForRole(
    chatroomId: string,
    role: ChatroomRole,
    taskId: string
  ): AssignedTaskSnapshotView | null {
    const snapshot = this.snapshots.get(snapshotKey(taskId, role));
    return snapshot?.chatroomId === chatroomId ? snapshot : null;
  }

  listAll(): AssignedTaskSnapshotView[] {
    return [...this.snapshots.values()];
  }

  upsert(snapshots: readonly AssignedTaskSnapshotView[]): void {
    for (const snapshot of snapshots) {
      this.snapshots.set(snapshotKey(snapshot.taskId, snapshot.agentConfig.role), snapshot);
    }
  }
}
