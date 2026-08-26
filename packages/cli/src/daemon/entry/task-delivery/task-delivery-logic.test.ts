import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listNativePendingTasksNeedingWake,
  listNativeTasksNeedingRevive,
  RecoveryCooldown,
} from './task-delivery-logic.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../../infrastructure/agent-operational/test-support.js';
import {
  createChatroomScopeBarrier,
  resetChatroomScopeBarrierForTests,
} from '../../infrastructure/agent-process-manager/execute-stop-targets-adapter.js';
import { unregisterNativeDeliverySession } from '../native-delivery/native-delivery-session-registry.js';

const pendingPlannerTask = {
  taskId: 'task-1',
  chatroomId: 'room-1',
  status: 'pending' as const,
  assignedTo: 'planner',
  updatedAt: 1,
  createdAt: 1,
  agentConfig: {
    role: 'planner',
    machineId: 'machine-1',
    agentHarness: 'cursor-sdk',
    workingDir: '/tmp',
  },
  participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
};

beforeEach(() =>
  registerTestNativeDeliverySession({
    runtime: undefined as never,
    effectContext: undefined as never,
    agentMgr: {} as never,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    operationalRows: [operationalRow('room-1', 'planner')],
  })
);
afterEach(() => {
  unregisterNativeDeliverySession();
  resetChatroomScopeBarrierForTests();
});

describe('task-delivery-logic', () => {
  it('revives a pending task when start cleared the backend PID', () => {
    const task = {
      ...pendingPlannerTask,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;

    expect(
      listNativeTasksNeedingRevive(
        [task],
        {
          getSlot: () => undefined,
          isPidAlive: () => false,
        },
        10_000,
        new RecoveryCooldown(0)
      )
    ).toEqual([task]);
  });

  describe('listNativePendingTasksNeedingWake', () => {
    it('skips wake when operational stopState is stopped', () => {
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [operationalRow('room-1', 'planner', 'stopped', 'stopped')],
      });

      expect(
        listNativePendingTasksNeedingWake([pendingPlannerTask], new RecoveryCooldown(0), 10_000)
      ).toEqual([]);
    });

    it('skips wake when chatroom stop scope is active', async () => {
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [operationalRow('room-1', 'planner', 'stopped')],
      });

      const barrier = createChatroomScopeBarrier();
      const release = await barrier.acquire('room-1');
      expect(
        listNativePendingTasksNeedingWake([pendingPlannerTask], new RecoveryCooldown(0), 10_000)
      ).toEqual([]);
      release();
    });

    it('still wakes on stale stopped operational without stop intent', () => {
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [operationalRow('room-1', 'planner', 'stopped')],
      });

      expect(
        listNativePendingTasksNeedingWake([pendingPlannerTask], new RecoveryCooldown(0), 10_000)
      ).toEqual([pendingPlannerTask]);
    });
  });
});
