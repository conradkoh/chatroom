import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { describe, expect, it, vi } from 'vitest';

import type { TaskInboxEventHistoryRow } from './ports/native-task-delivery.js';
import {
  buildTaskServiceDebugState,
  type TaskServiceDebugState,
} from './task-service-debug-state.js';
import type { AssignedTask } from '../../../domain/entities/assigned-task.js';
import { TaskInboxState } from '../../../infrastructure/inbox/task-inbox-state.js';

const CHATROOM = 'room-1';

function task(taskId: string, chatroomId = CHATROOM, status: AssignedTask['status'] = 'pending') {
  return {
    taskId,
    chatroomId,
    status,
    assignedTo: 'planner',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role: 'planner', machineId: 'machine-1' },
  } satisfies AssignedTask;
}

function event(overrides: Partial<TaskInboxEventHistoryRow> = {}): TaskInboxEventHistoryRow {
  return {
    eventId: 'event-1',
    eventType: WorkspaceTaskInboxEventType.TaskAssigned,
    status: WorkspaceTaskInboxEventStatus.Pending,
    role: 'planner',
    taskId: 'task-1',
    taskStatus: 'pending',
    createdAt: 100,
    ...overrides,
  };
}

function sources(rows: readonly TaskInboxEventHistoryRow[]) {
  return {
    taskInboxState: new TaskInboxState(),
    loadInboxEvents: vi.fn().mockResolvedValue(rows),
    chatroomId: CHATROOM,
  };
}

describe('buildTaskServiceDebugState', () => {
  it('reports the local read model for the requested chatroom only', async () => {
    const input = sources([]);
    input.taskInboxState.upsert([task('kept'), task('other-room', 'room-2')]);

    const state = await buildTaskServiceDebugState(input);

    expect(state.tasks.map((entry) => entry.taskId)).toEqual(['kept']);
    expect(state.knownTaskCount).toBe(2);
  });

  it('reports processed events so an acknowledged-but-undelivered task is visible', async () => {
    const input = sources([
      event({
        eventId: 'event-1',
        status: WorkspaceTaskInboxEventStatus.Processed,
        processedAt: 500,
      }),
      event({ eventId: 'event-2', eventType: WorkspaceTaskInboxEventType.TaskUpdated }),
    ]);

    const state = await buildTaskServiceDebugState(input);

    expect(state.inboxEvents).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        status: WorkspaceTaskInboxEventStatus.Processed,
        processedAt: 500,
      }),
      expect.objectContaining({
        eventId: 'event-2',
        eventType: WorkspaceTaskInboxEventType.TaskUpdated,
      }),
    ]);
  });

  it('reports an empty read model when the inbox never received a task', async () => {
    const state = await buildTaskServiceDebugState(sources([]));

    expect(state.tasks).toEqual([]);
    expect(state.knownTaskCount).toBe(0);
  });

  it('surfaces an inbox query failure without dropping the read model', async () => {
    const input = sources([]);
    input.taskInboxState.upsert([task('task-1')]);
    input.loadInboxEvents.mockRejectedValue(new Error('backend unavailable'));

    const state: TaskServiceDebugState = await buildTaskServiceDebugState(input);

    expect(state.inboxEventsError).toBe('backend unavailable');
    expect(state.inboxEvents).toEqual([]);
    expect(state.tasks.map((entry) => entry.taskId)).toEqual(['task-1']);
  });
});
