import { describe, expect, it } from 'vitest';

import { buildTaskServiceDebugState } from './task-service-debug-state.js';
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

describe('buildTaskServiceDebugState', () => {
  it('reports the daemon-local read model for the requested chatroom only', () => {
    const taskInboxState = new TaskInboxState();
    taskInboxState.upsert([task('kept'), task('other-room', 'room-2')]);

    const state = buildTaskServiceDebugState({ taskInboxState, chatroomId: CHATROOM });

    expect(state.tasks.map((entry) => entry.taskId)).toEqual(['kept']);
    expect(state.knownTaskCount).toBe(2);
  });

  it('reports an empty read model when the inbox never received a task', () => {
    const state = buildTaskServiceDebugState({
      taskInboxState: new TaskInboxState(),
      chatroomId: CHATROOM,
    });

    expect(state.tasks).toEqual([]);
    expect(state.knownTaskCount).toBe(0);
  });
});
