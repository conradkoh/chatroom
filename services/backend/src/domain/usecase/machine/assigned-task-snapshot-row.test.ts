import { describe, expect, it } from 'vitest';

import {
  applyAssignedTaskPresence,
  applyAssignedTaskSignal,
  assignedTaskSnapshotFromDoc,
} from './assigned-task-snapshot-row';
import type { AssignedTaskSignal } from './assigned-tasks-types';
import { snapshotDocToSignal } from './machine-assigned-task-snapshot-sync';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';

function makeSnapshotDoc(
  overrides: Partial<Doc<'chatroom_machineAssignedTaskSnapshots'>> = {}
): Doc<'chatroom_machineAssignedTaskSnapshots'> {
  const now = 1_700_000_000_000;
  return {
    _id: 'snapshot_1' as Id<'chatroom_machineAssignedTaskSnapshots'>,
    _creationTime: now,
    machineId: 'machine-1',
    taskId: 'task_1' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    role: 'builder',
    taskStatus: 'pending',
    taskAssignedTo: 'builder',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'opencode',
    workingDir: '/test/workspace',
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-key',
    revisionKey: 'revision-key',
    signalUpdatedAt: now,
    ...overrides,
  };
}

function makeExistingRow() {
  return assignedTaskSnapshotFromDoc(
    makeSnapshotDoc({
      lastSeenAction: 'native:waiting',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    })
  );
}

function makeSignal(overrides: Partial<AssignedTaskSignal> = {}): AssignedTaskSignal {
  return {
    taskId: 'task_1' as AssignedTaskSignal['taskId'],
    chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
    role: 'builder',
    status: 'pending',
    signalType: 'task',
    revisionKey: 'rev-1',
    machineId: 'machine-1',
    agentHarness: 'cursor-sdk',
    createdAt: 1_000,
    ...overrides,
  };
}

describe('bootstrapMonitorRowFromSignal', () => {
  it('builds a row from minimal bootstrap fields', () => {
    const row = applyAssignedTaskSignal(undefined, makeSignal());
    expect(row.taskId).toBe('task_1');
    expect(row.status).toBe('pending');
    expect(row.agentConfig.role).toBe('builder');
    expect(row.agentConfig.agentHarness).toBe('cursor-sdk');
    expect(row.agentConfig.machineId).toBe('machine-1');
  });

  it('includes optional bootstrap fields when present', () => {
    const row = applyAssignedTaskSignal(
      undefined,
      makeSignal({
        workingDir: '/tmp/project',
        assignedTo: 'builder',
      })
    );
    expect(row.agentConfig.workingDir).toBe('/tmp/project');
    expect(row.assignedTo).toBe('builder');
  });

});

describe('patchMonitorRowFromSignal', () => {
  it('does not patch deprecated participant status from signals', () => {
    const existing = makeExistingRow();
    const patched = applyAssignedTaskSignal(existing, makeSignal({}));
    expect(patched.participant).toBe(existing.participant);

  });

  it('preserves createdAt, lastSeenAt, and workingDir on partial signals', () => {
    const existing = makeExistingRow();
    const patched = applyAssignedTaskSignal(
      existing,
      makeSignal({
        status: 'acknowledged',
      })
    );

    expect(patched.status).toBe('acknowledged');
    expect(patched.createdAt).toBe(existing.createdAt);
    expect(patched.agentConfig.workingDir).toBe('/test/workspace');
  });
});

describe('applyAssignedTaskSignal', () => {
  it('bootstraps when no existing row', () => {
    const row = applyAssignedTaskSignal(undefined, makeSignal());
    expect(row.agentConfig.agentHarness).toBe('cursor-sdk');
  });

  it('patches when existing row is present', () => {
    const existing = makeExistingRow();
    const row = applyAssignedTaskSignal(existing, makeSignal({ status: 'in_progress' }));
    expect(row.status).toBe('in_progress');
    expect(row.createdAt).toBe(existing.createdAt);
  });
});

describe('applyAssignedTaskPresence', () => {
  it('returns undefined when no existing row', () => {
    expect(
      applyAssignedTaskPresence(undefined, {
        taskId: 'task_1' as AssignedTaskSignal['taskId'],
        chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
        role: 'builder',
        lastSeenAt: 1_000,
        presenceUpdatedAt: 1_000,
        presenceKey: 'pk',
      })
    ).toBeUndefined();
  });

  it('does not modify an existing row', () => {
    const existing = makeExistingRow();
    const merged = applyAssignedTaskPresence(existing, {
      taskId: existing.taskId,
      chatroomId: existing.chatroomId,
      role: existing.agentConfig.role,
      lastSeenAt: 2_000,
      lastSeenAction: 'native:waiting',
      presenceUpdatedAt: 2_000,
      presenceKey: 'pk-2',
    });
    expect(merged).toBe(existing);
  });

  it('preserves the existing row when presence omits it', () => {
    const existing = makeExistingRow();
    const merged = applyAssignedTaskPresence(existing, {
      taskId: existing.taskId,
      chatroomId: existing.chatroomId,
      role: existing.agentConfig.role,
      lastSeenAt: null,
      presenceUpdatedAt: 2_000,
      presenceKey: 'pk-2',
    });
    expect(merged).toBe(existing);
  });
});

describe('doc → signal → apply round-trip', () => {
  it('matches assignedTaskSnapshotFromDoc for bootstrap-capable signals', () => {
    const doc = makeSnapshotDoc({
      lastSeenAction: 'native:task-injected',
      lastStatus: 'task.completed',
    });
    const fromDoc = assignedTaskSnapshotFromDoc(doc);
    const fromSignal = applyAssignedTaskSignal(undefined, snapshotDocToSignal(doc));

    expect(fromSignal).toMatchObject({
      taskId: fromDoc.taskId,
      chatroomId: fromDoc.chatroomId,
      status: fromDoc.status,
      assignedTo: fromDoc.assignedTo,
      createdAt: fromDoc.createdAt,
      agentConfig: {
        role: fromDoc.agentConfig.role,
        machineId: fromDoc.agentConfig.machineId,
        agentHarness: fromDoc.agentConfig.agentHarness,
        workingDir: fromDoc.agentConfig.workingDir,
      },
    });
  });

  it('preserves revisionKey participant fields on signal bootstrap (not presence channel)', () => {
    const doc = makeSnapshotDoc({
      lastSeenAction: 'native:task-injected',
      lastStatus: 'task.completed',
      lastSeenAt: 9_999,
    });
    const fromSignal = applyAssignedTaskSignal(undefined, snapshotDocToSignal(doc));

    expect(fromSignal.participant).toBeUndefined();
  });
});
