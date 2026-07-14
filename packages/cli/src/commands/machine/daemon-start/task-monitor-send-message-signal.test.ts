/**
 * Daemon task-monitor contract: chatroom sendMessage → incremental signal → working snapshot.
 *
 * Backend integration coverage lives in
 * services/backend/tests/integration/subscribe-assigned-task-signals.spec.ts.
 * This test proves the CLI merge path that was dropping first-seen signals.
 */

import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { GET_NEXT_TASK_STARTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { snapshotDocToSignal } from '@workspace/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.js';
import { describe, expect, it } from 'vitest';

import { shouldDeliverNativeTask } from './native-task-injector-logic.js';
import { NudgeCooldown, listTasksReadyForNudge } from './task-monitor-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';

function makePostSendMessageSnapshotDoc(
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

describe('task monitor — sendMessage incremental signal', () => {
  it('adds chatroom message task to empty daemon snapshot when signal arrives', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);

    const signal = snapshotDocToSignal(makePostSendMessageSnapshotDoc());
    const row = snapshot.mergeSignal(signal);

    expect(row).toBeDefined();
    expect(snapshot.getByKey('task_1:builder')).toBe(row);
    expect(row).toMatchObject({
      taskId: 'task_1',
      status: 'pending',
      assignedTo: 'builder',
      createdAt: signal.createdAt,
      agentConfig: {
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
        spawnedAgentPid: 42_424,
        desiredState: 'running',
      },
    });
  });

  it('enables nudge pass after presence catches up for signal-discovered CLI tasks', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);

    const doc = makePostSendMessageSnapshotDoc({
      lastSeenAction: GET_NEXT_TASK_STARTED_ACTION,
    });
    const signal = snapshotDocToSignal(doc);
    const row = snapshot.mergeSignal(signal);
    expect(row).toBeDefined();

    snapshot.mergePresence({
      taskId: row!.taskId,
      chatroomId: row!.chatroomId,
      role: row!.agentConfig.role,
      lastSeenAt: row!.createdAt - 100,
      lastSeenAction: GET_NEXT_TASK_STARTED_ACTION,
      presenceUpdatedAt: row!.createdAt,
      presenceKey: 'presence-key-2',
    });

    const tracked = snapshot.getByKey('task_1:builder');
    expect(tracked).toBeDefined();

    const ready = listTasksReadyForNudge(
      [tracked!],
      tracked!.createdAt + 20_000,
      new NudgeCooldown(0)
    );
    expect(ready).toHaveLength(1);
  });

  it('enables native inject predicate after signal bootstrap on empty snapshot', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);

    const doc = makePostSendMessageSnapshotDoc({
      agentHarness: 'cursor-sdk',
      spawnedAgentPid: 99,
      lastSeenAction: 'native:waiting',
    });
    const row = snapshot.mergeSignal(snapshotDocToSignal(doc));
    expect(row).toBeDefined();

    expect(
      shouldDeliverNativeTask(row!, {
        slot: {
          state: 'running',
          pid: 99,
          harnessSessionId: 'session-abc',
        },
      })
    ).toBe(true);
  });
});
