import { describe, expect, it } from 'vitest';

import {
  applyAssignedTaskPresence,
  applyAssignedTaskSignal,
  monitorRowFromSnapshotDoc,
} from './assigned-task-monitor-row';
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
    spawnedAgentPid: 42_424,
    desiredState: 'running',
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-key',
    revisionKey: 'revision-key',
    signalUpdatedAt: now,
    ...overrides,
  };
}

function makeExistingRow() {
  return monitorRowFromSnapshotDoc(
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
    expect(row.participant?.lastSeenAt).toBeNull();
  });

  it('includes optional bootstrap fields when present', () => {
    const row = applyAssignedTaskSignal(
      undefined,
      makeSignal({
        workingDir: '/tmp/project',
        assignedTo: 'builder',
        spawnedAgentPid: 200,
        desiredState: 'running',
        lastSeenAction: 'get-next-task:started',
        lastStatus: 'agent.waiting',
      })
    );
    expect(row.agentConfig.workingDir).toBe('/tmp/project');
    expect(row.assignedTo).toBe('builder');
    expect(row.agentConfig.spawnedAgentPid).toBe(200);
    expect(row.participant?.lastSeenAction).toBe('get-next-task:started');
    expect(row.participant?.lastStatus).toBe('agent.waiting');
  });

  it('preserves lastStatus for post-completion queue promotion delivery', () => {
    const row = applyAssignedTaskSignal(
      undefined,
      makeSignal({
        lastSeenAction: 'native:task-injected',
        lastStatus: 'task.completed',
      })
    );
    expect(row.participant?.lastSeenAction).toBe('native:task-injected');
    expect(row.participant?.lastStatus).toBe('task.completed');
  });
});

describe('patchMonitorRowFromSignal', () => {
  it('patches lastStatus when signal carries a newer participant status', () => {
    const existing = makeExistingRow();
    const patched = applyAssignedTaskSignal(
      existing,
      makeSignal({
        lastSeenAction: 'native:task-injected',
        lastStatus: 'task.completed',
      })
    );

    expect(patched.participant?.lastSeenAction).toBe('native:task-injected');
    expect(patched.participant?.lastStatus).toBe('task.completed');
  });

  it('preserves createdAt, lastSeenAt, and workingDir on partial signals', () => {
    const existing = makeExistingRow();
    const patched = applyAssignedTaskSignal(
      existing,
      makeSignal({
        status: 'acknowledged',
        spawnedAgentPid: 999,
        lastSeenAction: 'task.injected',
      })
    );

    expect(patched.status).toBe('acknowledged');
    expect(patched.createdAt).toBe(existing.createdAt);
    expect(patched.agentConfig.workingDir).toBe('/test/workspace');
    expect(patched.participant?.lastSeenAt).toBe(500);
    expect(patched.agentConfig.spawnedAgentPid).toBe(999);
    expect(patched.participant?.lastSeenAction).toBe('task.injected');
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

  it('updates lastSeenAt while preserving other participant fields', () => {
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
    expect(merged?.participant?.lastSeenAt).toBe(2_000);
    expect(merged?.participant?.lastStatus).toBe('agent.waiting');
  });
});

describe('doc → signal → apply round-trip', () => {
  it('matches monitorRowFromSnapshotDoc for bootstrap-capable signals', () => {
    const doc = makeSnapshotDoc({
      lastSeenAction: 'native:task-injected',
      lastStatus: 'task.completed',
    });
    const fromDoc = monitorRowFromSnapshotDoc(doc);
    const fromSignal = applyAssignedTaskSignal(undefined, snapshotDocToSignal(doc));

    expect(fromSignal).toMatchObject({
      taskId: fromDoc.taskId,
      chatroomId: fromDoc.chatroomId,
      status: fromDoc.status,
      assignedTo: fromDoc.assignedTo,
      createdAt: fromDoc.createdAt,
      participant: {
        lastSeenAction: 'native:task-injected',
        lastStatus: 'task.completed',
      },
      agentConfig: {
        role: fromDoc.agentConfig.role,
        machineId: fromDoc.agentConfig.machineId,
        agentHarness: fromDoc.agentConfig.agentHarness,
        workingDir: fromDoc.agentConfig.workingDir,
        spawnedAgentPid: fromDoc.agentConfig.spawnedAgentPid,
        desiredState: fromDoc.agentConfig.desiredState,
      },
    });
  });

  it('preserves revisionKey participant fields on signal bootstrap (not presence channel)', () => {
    const doc = makeSnapshotDoc({
      lastSeenAction: 'native:task-injected',
      lastStatus: 'task.completed',
      lastSeenAt: 9_999,
    });
    const fromDoc = monitorRowFromSnapshotDoc(doc);
    const fromSignal = applyAssignedTaskSignal(undefined, snapshotDocToSignal(doc));

    expect(fromSignal.participant?.lastSeenAction).toBe(fromDoc.participant?.lastSeenAction);
    expect(fromSignal.participant?.lastStatus).toBe(fromDoc.participant?.lastStatus);
    // lastSeenAt is presence-channel only — signal bootstrap must not pretend to carry it.
    expect(fromSignal.participant?.lastSeenAt).toBeNull();
  });
});
