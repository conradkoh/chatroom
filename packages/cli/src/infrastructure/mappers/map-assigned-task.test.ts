import type {
  AssignedTaskSnapshotView as BackendAssignedTaskSnapshotView,
  AssignedTaskView as BackendAssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import {
  advanceTaskEnvelopeWorkflow,
  createTaskEnvelope,
  type TaskEnvelopeV1,
} from '@workspace/shared/domain/task-envelope';
import { describe, expect, test } from 'vitest';

import {
  mapAssignedTaskSnapshot,
  mapAssignedTaskSnapshotList,
  mapAssignedTaskView,
} from './map-assigned-task.js';

const backendSnapshot = {
  taskId: 'task_1',
  chatroomId: 'room_1',
  status: 'pending' as const,
  assignedTo: 'user_1',
  updatedAt: 1000,
  createdAt: 900,
  agentConfig: {
    role: 'builder',
    machineId: 'machine_1',
    agentHarness: 'cursor',
    model: 'gpt-4',
    workingDir: '/tmp/ws',
    spawnedAgentPid: 42,
    desiredState: 'running' as const,
    circuitState: 'closed' as const,
  },
  participant: {
    lastSeenAction: 'waiting',
    lastSeenAt: 950,
    lastStatus: 'active',
  },
} as BackendAssignedTaskSnapshotView;

describe('map-assigned-task', () => {
  test('mapAssignedTaskSnapshot preserves snapshot fields', () => {
    const mapped = mapAssignedTaskSnapshot(backendSnapshot);

    expect(mapped.taskId).toBe('task_1');
    expect(mapped.chatroomId).toBe('room_1');
    expect(mapped.status).toBe('pending');
    expect(mapped.agentConfig.role).toBe('builder');
    expect(mapped.agentConfig.machineId).toBe('machine_1');
    expect(mapped.participant?.lastSeenAction).toBe('waiting');
  });

  test('mapAssignedTaskView includes taskContent', () => {
    const mapped = mapAssignedTaskView({
      ...backendSnapshot,
      taskContent: 'Do the thing',
    } as BackendAssignedTaskView);

    expect(mapped.taskContent).toBe('Do the thing');
    expect(mapped.taskId).toBe('task_1');
    expect(mapped.agentConfig.workingDir).toBe('/tmp/ws');
  });

  test('mapAssignedTaskView passes the explicit envelope through unchanged', () => {
    const envelope: TaskEnvelopeV1 = advanceTaskEnvelopeWorkflow(
      createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' })
    );
    expect(envelope.handoffWorkflow.phase).not.toBe('entry');

    const mapped = mapAssignedTaskView({
      ...backendSnapshot,
      taskContent: 'Do the thing',
      taskEnvelope: envelope,
      startInNewSession: false,
    } as BackendAssignedTaskView);

    expect(mapped.taskEnvelope).toEqual(envelope);
    expect(mapped.taskEnvelope?.sessionPolicy).toBe('new');
    expect(mapped.taskEnvelope?.handoffWorkflow).toEqual(envelope.handoffWorkflow);
    expect(mapped.startInNewSession).toBe(false);
  });

  test('mapAssignedTaskSnapshotList maps each row', () => {
    const mapped = mapAssignedTaskSnapshotList([backendSnapshot, backendSnapshot]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]?.taskId).toBe('task_1');
    expect(mapped[1]?.taskId).toBe('task_1');
  });
});
