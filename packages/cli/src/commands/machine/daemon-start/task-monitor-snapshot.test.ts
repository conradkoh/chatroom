import type {
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, it } from 'vitest';

import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';

function makeSnapshot(overrides: Partial<AssignedTaskSnapshotView> = {}): AssignedTaskSnapshotView {
  return {
    taskId: 'task_1' as AssignedTaskSnapshotView['taskId'],
    chatroomId: 'room_1' as AssignedTaskSnapshotView['chatroomId'],
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp/project',
      spawnedAgentPid: 100,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native.waiting',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

function makeSignal(overrides: Partial<AssignedTaskSignal> = {}): AssignedTaskSignal {
  return {
    taskId: 'task_1' as AssignedTaskSignal['taskId'],
    chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
    role: 'builder',
    status: 'pending',
    signalType: 'task',
    revisionKey: 'rev-1',
    lastSeenAction: 'native.waiting',
    spawnedAgentPid: 200,
    desiredState: 'running',
    agentHarness: 'cursor-sdk',
    workingDir: '/tmp/project',
    assignedTo: 'builder',
    createdAt: 1_000,
    ...overrides,
  };
}

describe('createTaskMonitorSnapshot', () => {
  it('replaces all rows on reconcile refresh', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([makeSnapshot()]);
    expect(snapshot.getByKey('task_1:builder')).toBeDefined();

    snapshot.replaceAll([]);
    expect(snapshot.getByKey('task_1:builder')).toBeUndefined();
  });

  it('merges incremental signals while preserving reconcile-only fields', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([makeSnapshot()]);

    const merged = snapshot.mergeSignal(
      makeSignal({
        status: 'acknowledged',
        lastSeenAction: 'task.injected',
        spawnedAgentPid: 200,
      })
    );

    expect(merged?.status).toBe('acknowledged');
    expect(merged?.agentConfig.spawnedAgentPid).toBe(200);
    expect(merged?.participant?.lastSeenAction).toBe('task.injected');
    expect(merged?.participant?.lastSeenAt).toBe(500);
    expect(merged?.createdAt).toBe(1_000);
    expect(merged?.assignedTo).toBe('builder');
    expect(snapshot.getByKey('task_1:builder')?.participant?.lastSeenAction).toBe('task.injected');
  });

  it('constructs a new row when merging a signal with no base row', () => {
    const snapshot = createTaskMonitorSnapshot();
    const merged = snapshot.mergeSignal(makeSignal());
    expect(merged).toBeDefined();
    expect(merged?.taskId).toBe('task_1');
    expect(merged?.status).toBe('pending');
    expect(merged?.agentConfig.role).toBe('builder');
    expect(merged?.agentConfig.agentHarness).toBe('cursor-sdk');
    expect(merged?.agentConfig.workingDir).toBe('/tmp/project');
    expect(merged?.agentConfig.spawnedAgentPid).toBe(200);
    expect(merged?.createdAt).toBe(1_000);
    expect(merged?.participant?.lastSeenAction).toBe('native.waiting');
    expect(merged?.participant?.lastSeenAt).toBeNull();
    expect(snapshot.getByKey('task_1:builder')).toBe(merged);
  });
});
