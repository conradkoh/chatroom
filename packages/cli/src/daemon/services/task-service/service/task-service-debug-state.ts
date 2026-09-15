/**
 * Task service diagnostics for `chatroom debug`.
 *
 * Answers the two questions that separate the failure modes of a task that
 * stays `pending` while its agent is idle:
 *
 *   1. Does the daemon's in-memory read model know about the task? (`tasks`)
 *      A task missing here can never be delivered, because delivery only reads
 *      this model.
 *   2. Did the backend ever hand the daemon an inbox event for it, and when did
 *      the daemon acknowledge that event? (`inboxEvents`)
 *      An acknowledged event without delivery means the event was consumed and
 *      will never replay; no event at all means the daemon was never notified.
 */

import type { TaskInboxEventHistoryRow } from './ports/native-task-delivery.js';
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
  readonly inboxEvents: readonly TaskInboxEventHistoryRow[];
  readonly inboxEventsError?: string | undefined;
}

/**
 * Reads the task-service state for one chatroom. Never throws: a failed inbox
 * history query is reported inline so the rest of the dump still renders.
 */
export async function buildTaskServiceDebugState(input: {
  taskInboxState: TaskInboxStateReader;
  loadInboxEvents: () => Promise<readonly TaskInboxEventHistoryRow[]>;
  chatroomId: string;
}): Promise<TaskServiceDebugState> {
  const allTasks = input.taskInboxState.listAll();
  const base = {
    tasks: allTasks.filter((task) => task.chatroomId === input.chatroomId),
    knownTaskCount: allTasks.length,
  };

  try {
    return { ...base, inboxEvents: await input.loadInboxEvents() };
  } catch (error) {
    return {
      ...base,
      inboxEvents: [],
      inboxEventsError: error instanceof Error ? error.message : String(error),
    };
  }
}
