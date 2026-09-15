/**
 * Daemon-local task state for `chatroom debug`.
 *
 * This is the in-memory read model that native delivery actually reads, so it
 * answers one question no server-side query can: does *this daemon* know about
 * the task? A task missing here can never be delivered, however healthy the
 * server's rows look, because nothing rehydrates this model from storage.
 *
 * Server-side models (`chatroom_tasks`, `chatroomWorkspaceTaskInbox`,
 * `chatroom_taskDeliveryReceipts`, …) come from `api.daemon.chatroom.debug` and
 * are reported separately, keyed by table name.
 */

import type { AssignedTask } from '../../../domain/entities/assigned-task.js';
import type { TaskInboxStateReader } from '../../../infrastructure/inbox/task-inbox-state.js';

export interface TaskServiceDebugState {
  /** Tasks in the local read model for this chatroom — the only input delivery reads. */
  readonly tasks: readonly AssignedTask[];
  /**
   * Tasks the read model holds across every chatroom. Separates "inbox alive but
   * missing this task" from "inbox never received anything".
   */
  readonly knownTaskCount: number;
}

/** Pure projection of an already-loaded read model. */
export function buildTaskServiceDebugState(input: {
  taskInboxState: TaskInboxStateReader;
  chatroomId: string;
}): TaskServiceDebugState {
  const allTasks = input.taskInboxState.listAll();
  return {
    tasks: allTasks.filter((task) => task.chatroomId === input.chatroomId),
    knownTaskCount: allTasks.length,
  };
}
