// fallow-ignore-file unused-class-member
import type { ChatroomRole } from '@workspace/shared/domain/chatroom-role';

import type { AssignedTask } from '../../domain/entities/assigned-task.js';

function taskKey(taskId: string, role: string): string {
  return `${taskId}:${role.toLowerCase()}`;
}

/**
 * Whether a post-backend-success status patch is stale relative to the
 * locally applied inbox state: strictly older timestamps never regress newer
 * state, and an equal-timestamp terminal (`completed`) task is never
 * regressed to a non-terminal status.
 */
function isStaleStatusPatch(
  current: AssignedTask,
  status: AssignedTask['status'],
  updatedAt: number
): boolean {
  if (current.updatedAt > updatedAt) return true;
  return (
    current.updatedAt === updatedAt &&
    // Widened: hydrated rows are typed active-only, but a terminal row at the
    // same timestamp must still win over a stale pending recovery.
    (current.status as string) === 'completed' &&
    (status as string) !== 'completed'
  );
}

/**
 * In-memory task read model owned by the daemon task service.
 *
 * The task service is the only component that mutates this state. Consumers such as
 * idle delivery read from it instead of querying processed inbox history from Convex.
 */
export class TaskInboxState {
  private readonly tasks = new Map<string, AssignedTask>();
  private initialized = false;

  replace(tasks: readonly AssignedTask[]): void {
    this.tasks.clear();
    this.upsert(tasks);
    this.initialized = true;
  }

  listForRole(chatroomId: string, role: ChatroomRole): AssignedTask[] {
    const roleLower = role.toLowerCase();
    return [...this.tasks.values()].filter(
      (task) => task.chatroomId === chatroomId && task.agentConfig.role.toLowerCase() === roleLower
    );
  }

  /** Whether the initial inbox state has been loaded successfully. */
  isInitialized(): boolean {
    return this.initialized;
  }

  getForRole(chatroomId: string, role: ChatroomRole, taskId: string): AssignedTask | null {
    const task = this.tasks.get(taskKey(taskId, role));
    return task?.chatroomId === chatroomId ? task : null;
  }

  listAll(): AssignedTask[] {
    return [...this.tasks.values()];
  }

  upsert(tasks: readonly AssignedTask[]): void {
    for (const task of tasks) {
      this.tasks.set(taskKey(task.taskId, task.agentConfig.role), task);
    }
  }

  remove(chatroomId: string, role: string, taskId: string): boolean {
    const key = taskKey(taskId, role);
    const task = this.tasks.get(key);
    if (!task || task.chatroomId !== chatroomId) return false;
    return this.tasks.delete(key);
  }

  /**
   * Patches the status of an existing inbox task after a backend-confirmed
   * transition. Never creates a task; returns false when no matching task
   * exists. Call only after the backend mutation resolves — the
   * backend row is authoritative, this cache is not.
   *
   * The patch is monotonic: a stale response (strictly older `updatedAt`)
   * never regresses a newer locally applied state, and an equal-timestamp
   * terminal (`completed`) task is never regressed to a non-terminal
   * status. Returning false is sufficient; callers do not retry.
   */
  markStatus(
    chatroomId: string,
    role: ChatroomRole,
    taskId: string,
    status: AssignedTask['status'],
    updatedAt: number
  ): boolean {
    const key = taskKey(taskId, role);
    const task = this.tasks.get(key);
    if (!task || task.chatroomId !== chatroomId) return false;
    if (isStaleStatusPatch(task, status, updatedAt)) return false;
    this.tasks.set(key, { ...task, status, updatedAt });
    return true;
  }
}

/** Read-only view exposed to services that consume task notifications. */
export interface TaskInboxStateReader {
  listForRole(chatroomId: string, role: ChatroomRole): readonly AssignedTask[];
  listAll(): readonly AssignedTask[];
  isInitialized(): boolean;
  getForRole(chatroomId: string, role: ChatroomRole, taskId: string): AssignedTask | null;
}
