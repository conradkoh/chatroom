import { describe, expect, it } from 'vitest';

import {
  assignedTaskSnapshotRowSchema,
  assignedTaskPresenceDeltaSchema,
  assignedTaskSignalBootstrapFields,
  assignedTaskSignalSchema,
  parseAssignedTaskSnapshotRows,
  parseAssignedTaskPresenceSignal,
  parseAssignedTaskSignal,
} from './assigned-task-snapshot-contract';
import { applyAssignedTaskSignal } from './assigned-task-snapshot-row';
import type { AssignedTaskSignal } from './assigned-tasks-types';

function minimalSignal(): AssignedTaskSignal {
  return {
    taskId: 'task_1' as AssignedTaskSignal['taskId'],
    chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
    role: 'builder',
    status: 'pending',
    signalType: 'task',
    revisionKey: 'rev-1',
    machineId: 'machine-1',
    agentHarness: 'opencode',
    createdAt: 1_000,
  };
}

describe('assignedTaskSignalSchema', () => {
  it('accepts a minimal bootstrap-capable signal', () => {
    expect(assignedTaskSignalSchema.safeParse(minimalSignal()).success).toBe(true);
  });

  it('rejects signals missing bootstrap fields', () => {
    const { agentHarness: _agentHarness, createdAt: _createdAt, ...incomplete } = minimalSignal();
    expect(assignedTaskSignalSchema.safeParse(incomplete).success).toBe(false);
  });

  it('parseAssignedTaskSignal returns typed domain signal without casts', () => {
    const parsed = parseAssignedTaskSignal(minimalSignal());
    expect(parsed.taskId).toBe('task_1');
    expect(parsed.chatroomId).toBe('room_1');
  });

  it('parses presence and hydrate rows with typed Convex IDs', () => {
    const presence = parseAssignedTaskPresenceSignal({
      taskId: 'task_1',
      role: 'builder',
      presenceKey: '000000000001000:task_1:builder',
    });
    expect(presence.presenceUpdatedAt).toBe(1000);
    expect(presence.taskId).toBe('task_1');
    expect(presence.role).toBe('builder');

    const row = parseAssignedTaskSnapshotRows([
      {
        taskId: 'task_1',
        chatroomId: 'room_1',
        status: 'pending',
        updatedAt: 1_000,
        createdAt: 1_000,
        agentConfig: {
          role: 'builder',
          machineId: 'machine-1',
          agentHarness: 'opencode',
        },
      },
    ])[0]!;
    expect(assignedTaskSnapshotRowSchema.safeParse(row).success).toBe(true);
    expect(parseAssignedTaskSnapshotRows([row])).toHaveLength(1);
  });

  it('bootstrap helpers align with schema fields', () => {
    const signal = minimalSignal();
    applyAssignedTaskSignal(undefined, signal);
    applyAssignedTaskSignal(applyAssignedTaskSignal(undefined, signal), {
      ...signal,
      status: 'acknowledged',
    });
  });

  it('bootstrap row fields are covered by schema keys', () => {
    const bootstrapKeys = new Set([
      'taskId',
      'chatroomId',
      'role',
      'status',
      'machineId',
      'assignedTo',
      'createdAt',
      'agentHarness',
      'workingDir',
    ]);
    const schemaKeys = new Set(Object.keys(assignedTaskSignalBootstrapFields));
    for (const key of bootstrapKeys) {
      expect(schemaKeys.has(key), `schema missing bootstrap field: ${key}`).toBe(true);
    }
    // Exercise bootstrap path so drift surfaces in tests.
    applyAssignedTaskSignal(undefined, minimalSignal());
  });

  it('participant fields are absent from signal schema', () => {
    const schemaKeys = new Set(Object.keys(assignedTaskSignalBootstrapFields));
    expect(schemaKeys.has('lastSeenAction')).toBe(false);
    expect(schemaKeys.has('lastStatus')).toBe(false);
  });

  it('parses slim presence delta wire payload and expands to full signal', () => {
    const delta = {
      taskId: 'task_1' as AssignedTaskSignal['taskId'],
      role: 'builder',
      presenceKey: '000000000001500:task_1:builder',
    };
    expect(assignedTaskPresenceDeltaSchema.safeParse(delta).success).toBe(true);

    const expanded = parseAssignedTaskPresenceSignal(delta);
    expect(expanded.taskId).toBe('task_1');
    expect(expanded.role).toBe('builder');
    expect(expanded.presenceKey).toBe(delta.presenceKey);
    expect(expanded.presenceUpdatedAt).toBe(1500);
    expect(expanded.lastSeenAt).toBe(1500);
  });

  it('falls back to full presence wire payload when delta fields are absent', () => {
    const full = {
      taskId: 'task_1' as AssignedTaskSignal['taskId'],
      chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
      role: 'builder',
      lastSeenAt: 1_200,
      presenceUpdatedAt: 1_500,
      presenceKey: '000000000001500:task_1:builder',
    };
    const parsed = parseAssignedTaskPresenceSignal(full);
    expect(parsed).toEqual(full);
  });

  it('parses slim deltas when full-wire keys are present but undefined', () => {
    const parsed = parseAssignedTaskPresenceSignal({
      taskId: 'task_1' as AssignedTaskSignal['taskId'],
      role: 'builder',
      presenceKey: '000000000001500:task_1:builder',
      chatroomId: undefined,
      presenceUpdatedAt: undefined,
    });
    expect(parsed.presenceUpdatedAt).toBe(1500);
    expect(parsed.lastSeenAt).toBe(1500);
    expect(parsed.taskId).toBe('task_1');
    expect(parsed.role).toBe('builder');
  });
});
