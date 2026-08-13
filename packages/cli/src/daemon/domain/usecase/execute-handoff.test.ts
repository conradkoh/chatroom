import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { HandoffChatroomPort } from './execute-handoff.js';
import { executeHandoff } from './execute-handoff.js';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';
import * as tasksModule from '../../infrastructure/persistence/read-models/tasks.js';
import {
  listActiveTaskReadModelsForChatroom,
  listTaskReadModelsForChatroomRole,
  taskReadModelFromSnapshot,
  upsertTaskReadModel,
} from '../../infrastructure/persistence/read-models/tasks.js';
import type { AssignedTaskSnapshotView } from '../entities/assigned-task.js';
import type { OutboundEvent } from '../entities/outbound-event.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'execute-handoff-'));
  return join(dir, 'events.sqlite');
}

function makeSnapshot(overrides?: Partial<AssignedTaskSnapshotView>): AssignedTaskSnapshotView {
  return {
    taskId: 'task-planner',
    chatroomId: 'room-1',
    status: 'in_progress',
    assignedTo: 'planner',
    updatedAt: 200,
    createdAt: 100,
    agentConfig: {
      role: 'planner',
      machineId: 'machine-1',
      agentHarness: 'opencode',
    },
    ...overrides,
  };
}

function makePort(overrides?: Partial<HandoffChatroomPort>): HandoffChatroomPort {
  return {
    getContext: vi.fn(async () => ({
      teamRoles: ['planner', 'builder'],
      supportsNativeIntegration: false,
      hasActiveEnhancerWork: false,
    })),
    getAgentHarness: vi.fn(async (_chatroomId, role) =>
      role === 'builder' ? 'opencode' : 'opencode'
    ),
    ...overrides,
  };
}

describe('executeHandoff', () => {
  it('planner → builder completes in_progress task, creates builder task, appends event', async () => {
    const db = openDatabase(tempDbPath());
    const events: OutboundEvent[] = [];
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));

      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: (event) => events.push(event),
          now: () => 1000,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'handoff message',
          targetRole: 'builder',
        }
      );

      expect(result.success).toBe(true);
      expect(result.completedTaskIds).toEqual(['task-planner']);
      expect(result.newTaskId).toBeTruthy();

      const plannerTasks = listTaskReadModelsForChatroomRole(db, 'room-1', 'planner');
      expect(plannerTasks[0]?.status).toBe('completed');

      const builderTasks = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder');
      expect(builderTasks).toHaveLength(1);
      expect(builderTasks[0]?.status).toBe('pending');
      expect(builderTasks[0]?.assignedTo).toBe('builder');

      expect(db.prepare("SELECT event_type FROM outbound_events WHERE event_type = 'handoff.completed'").all()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('emits a local task-ready event for a handoff to builder', async () => {
    const db = openDatabase(tempDbPath());
    const emitOrchestrationEvent = vi.fn();
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));
      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: () => {},
          emitOrchestrationEvent,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'local handoff',
          targetRole: 'builder',
        }
      );
      expect(result.newTaskId).toEqual(expect.any(String));
      expect(emitOrchestrationEvent).not.toHaveBeenCalled();
      process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY = '1';
      const second = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: () => {},
          emitOrchestrationEvent,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'local handoff 2',
          targetRole: 'builder',
        }
      );
      expect(emitOrchestrationEvent).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: second.newTaskId,
        source: 'handoff',
      });
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY;
      db.close();
    }
  });

  it('planner → user handoff does not create a new task', async () => {
    const db = openDatabase(tempDbPath());
    const events: OutboundEvent[] = [];
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));

      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: (event) => events.push(event),
          now: () => 1000,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'done',
          targetRole: 'user',
        }
      );

      expect(result.success).toBe(true);
      expect(result.newTaskId).toBeNull();
      expect(listActiveTaskReadModelsForChatroom(db, 'room-1')).toHaveLength(0);
      expect(db.prepare("SELECT event_type FROM outbound_events WHERE event_type = 'handoff.completed'").all()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('promotes next queued task to pending on handoff-to-user when no active tasks remain', async () => {
    const db = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));
      upsertTaskReadModel(db, {
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-queued',
        status: 'queued',
        assignedTo: 'builder',
        agentHarness: 'opencode',
        machineId: 'machine-1',
        createdAt: 500,
        updatedAt: 500,
      });

      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: () => {},
          now: () => 1000,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'done',
          targetRole: 'user',
        }
      );

      expect(result.success).toBe(true);
      expect(result.promotedTaskId).toBe('task-queued');
      const queuedNow = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder')[0];
      expect(queuedNow?.status).toBe('pending');
    } finally {
      db.close();
    }
  });

  it('rejects invalid target role with suggested targets', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort(),
          appendEvent: () => {},
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'msg',
          targetRole: 'reviewer',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_TARGET_ROLE');
      expect(result.error?.suggestedTargets).toEqual(['user', 'planner', 'builder']);
    } finally {
      db.close();
    }
  });

  it('rejects when enhancer review is in progress', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort({
            getContext: vi.fn(async () => ({
              teamRoles: ['planner', 'builder'],
              supportsNativeIntegration: false,
              hasActiveEnhancerWork: true,
            })),
          }),
          appendEvent: () => {},
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'msg',
          targetRole: 'builder',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENHANCER_REVIEW_IN_PROGRESS');
    } finally {
      db.close();
    }
  });

  it('rejects planner → enhancer without active planner task', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort({
            getContext: vi.fn(async () => ({
              teamRoles: ['planner', 'builder'],
              supportsNativeIntegration: false,
              hasActiveEnhancerWork: false,
              enhancerConfig: {
                enabled: true,
                machineId: 'machine-1',
                agentHarness: 'opencode',
                model: 'gpt-4o',
              },
            })),
          }),
          appendEvent: () => {},
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'msg',
          targetRole: 'enhancer',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_PLANNER_USER_TASK');
    } finally {
      db.close();
    }
  });

  it('rolls back read models when transaction fails', async () => {
    const db = openDatabase(tempDbPath());
    const events: OutboundEvent[] = [];
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));

      const originalUpsert = tasksModule.upsertTaskReadModel;
      let callCount = 0;
      vi.spyOn(tasksModule, 'upsertTaskReadModel').mockImplementation((database, row) => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error('boom');
        }
        return originalUpsert(database, row);
      });

      await expect(
        executeHandoff(
          {
            db,
            machineId: 'machine-1',
            chatroom: makePort(),
            appendEvent: (event) => events.push(event),
          },
          {
            sessionId: 'session-1',
            chatroomId: 'room-1',
            senderRole: 'planner',
            content: 'msg',
            targetRole: 'builder',
          }
        )
      ).rejects.toThrow('boom');

      const plannerTasks = listTaskReadModelsForChatroomRole(db, 'room-1', 'planner');
      expect(plannerTasks[0]?.status).toBe('in_progress');
      expect(events).toHaveLength(0);
    } finally {
      db.close();
      vi.restoreAllMocks();
    }
  });

  it('enqueues enhancer job locally when P4 enabled on planner → enhancer handoff', async () => {
    const db = openDatabase(tempDbPath());
    const enqueued: unknown[] = [];
    process.env.DAEMON_ORCHESTRATION_P4 = '1';
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));

      const result = await executeHandoff(
        {
          db,
          machineId: 'machine-1',
          chatroom: makePort({
            getContext: vi.fn(async () => ({
              teamRoles: ['planner', 'builder'],
              supportsNativeIntegration: false,
              hasActiveEnhancerWork: false,
              enhancerConfig: {
                enabled: true,
                machineId: 'machine-1',
                agentHarness: 'opencode',
                model: 'gpt-4o',
              },
            })),
          }),
          appendEvent: () => {},
          enqueueEnhancerJob: (input) => enqueued.push(input),
          now: () => 1000,
        },
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          senderRole: 'planner',
          content: 'please review',
          targetRole: 'enhancer',
        }
      );

      expect(result.success).toBe(true);
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toMatchObject({
        chatroomId: 'room-1',
        machineId: 'machine-1',
        payload: {
          agentHarness: 'opencode',
          model: 'gpt-4o',
          machineId: 'machine-1',
          content: 'please review',
        },
      });
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P4;
      db.close();
    }
  });
});
