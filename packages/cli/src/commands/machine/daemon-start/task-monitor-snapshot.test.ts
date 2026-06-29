import type {
  AssignedTaskLiteView,
  AssignedTaskSignal,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, it } from 'vitest';

import { TaskMonitorSnapshot } from './task-monitor-snapshot.js';

function makeLite(overrides: Partial<AssignedTaskLiteView> = {}): AssignedTaskLiteView {
  return {
    taskId: 'task_1' as AssignedTaskLiteView['taskId'],
    chatroomId: 'room_1' as AssignedTaskLiteView['chatroomId'],
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
    ...overrides,
  };
}

describe('TaskMonitorSnapshot', () => {
  it('replaces all rows on reconcile refresh', () => {
    const snapshot = new TaskMonitorSnapshot();
    snapshot.replaceAll([makeLite()]);
    expect(snapshot.get('task_1', 'builder')).toBeDefined();

    snapshot.replaceAll([]);
    expect(snapshot.get('task_1', 'builder')).toBeUndefined();
  });

  it('merges signals while preserving timing fields from the lite row', () => {
    const snapshot = new TaskMonitorSnapshot();
    snapshot.replaceAll([makeLite()]);

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
    expect(snapshot.get('task_1', 'builder')?.participant?.lastSeenAction).toBe('task.injected');
  });

  it('returns undefined when merging a signal with no base row', () => {
    const snapshot = new TaskMonitorSnapshot();
    expect(snapshot.mergeSignal(makeSignal())).toBeUndefined();
  });
});
