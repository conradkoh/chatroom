import { describe, expect, it } from 'vitest';

import {
  assignedTaskMonitorRowSchema,
  assignedTaskPresenceSignalSchema,
  assignedTaskSignalBootstrapFields,
  assignedTaskSignalSchema,
  parseAssignedTaskMonitorRows,
  parseAssignedTaskPresenceSignal,
  parseAssignedTaskSignal,
} from './assigned-task-monitor-contract';
import { applyAssignedTaskSignal } from './assigned-task-monitor-row';
import type { AssignedTaskSignal } from './assigned-tasks-types';

function minimalSignal(): AssignedTaskSignal {
  return {
    taskId: 'task_1' as AssignedTaskSignal['taskId'],
    chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
    role: 'builder',
    status: 'pending',
    signalType: 'task',
    revisionKey: 'rev-1',
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
      chatroomId: 'room_1',
      role: 'builder',
      lastSeenAt: 1_000,
      presenceUpdatedAt: 1_000,
      presenceKey: 'pk',
    });
    expect(assignedTaskPresenceSignalSchema.safeParse(presence).success).toBe(true);

    const row = parseAssignedTaskMonitorRows([
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
    expect(assignedTaskMonitorRowSchema.safeParse(row).success).toBe(true);
    expect(parseAssignedTaskMonitorRows([row])).toHaveLength(1);
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
      'assignedTo',
      'createdAt',
      'agentHarness',
      'workingDir',
      'spawnedAgentPid',
      'desiredState',
      'lastSeenAction',
    ]);
    const schemaKeys = new Set(Object.keys(assignedTaskSignalBootstrapFields));
    for (const key of bootstrapKeys) {
      expect(schemaKeys.has(key), `schema missing bootstrap field: ${key}`).toBe(true);
    }
    // Exercise bootstrap path so drift surfaces in tests.
    applyAssignedTaskSignal(undefined, minimalSignal());
  });
});
