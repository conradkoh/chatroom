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

  it('skips revive when explicit cold-session task owns spawn with slot down', () => {
    const task = {
      ...pendingPlannerTask,
      requestsNativeColdSession: true,
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
    ).toEqual([]);
  });

  it('still revives continue-session tasks when slot is down', () => {
    const task = {
      ...pendingPlannerTask,
      requestsNativeColdSession: false,
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

  it('suppresses revive for a role whose selected candidate owns cold start', () => {
    const health = {
      getSlot: () => undefined,
      isPidAlive: () => false,
    };
    const coldFirst = {
      ...pendingPlannerTask,
      taskId: 'task-cold',
      createdAt: 1,
      requestsNativeColdSession: true,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;
    const continueSecond = {
      ...pendingPlannerTask,
      taskId: 'task-continue',
      createdAt: 2,
      requestsNativeColdSession: false,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;
    // Selected candidate (pending-first/createdAt) is the cold task, so the
    // continue row queued behind it must not revive ahead of delivery.
    expect(
      listNativeTasksNeedingRevive(
        [coldFirst, continueSecond],
        health,
        10_000,
        new RecoveryCooldown(0)
      )
    ).toEqual([]);
  });

  it('does not privilege a later cold task behind a continue candidate', () => {
    const health = {
      getSlot: () => undefined,
      isPidAlive: () => false,
    };
    const continueFirst = {
      ...pendingPlannerTask,
      taskId: 'task-continue',
      createdAt: 1,
      requestsNativeColdSession: false,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;
    const coldSecond = {
      ...pendingPlannerTask,
      taskId: 'task-cold',
      createdAt: 2,
      requestsNativeColdSession: true,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;
    // Production cooldown: the selected continue candidate revives once; the
    // later cold row must not trigger a competing spawn in the same pass.
    expect(
      listNativeTasksNeedingRevive(
        [continueFirst, coldSecond],
        health,
        10_000,
        new RecoveryCooldown()
      )
    ).toEqual([continueFirst]);
  });

  it('suppresses revive for a running slot with a dead PID when cold owns it', () => {
    const task = {
      ...pendingPlannerTask,
      requestsNativeColdSession: true,
      agentConfig: { ...pendingPlannerTask.agentConfig, desiredState: 'running' },
    } as never;
    expect(
      listNativeTasksNeedingRevive(
        [task],
        {
          getSlot: () => ({ state: 'running', pid: 4242, nativeTurnPhase: 'idle' }) as never,
          isPidAlive: () => false,
        },
        10_000,
        new RecoveryCooldown(0)
      )
    ).toEqual([]);
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

    it('does not wake an agent whose start circuit is open', () => {
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [operationalRow('room-1', 'planner', 'circuit_open')],
      });

      expect(
        listNativePendingTasksNeedingWake([pendingPlannerTask], new RecoveryCooldown(0), 10_000)
      ).toEqual([]);
    });

    it('does not wake explicit cold-session pending tasks', () => {
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [operationalRow('room-1', 'planner', 'stopped')],
      });

      expect(
        listNativePendingTasksNeedingWake(
          [{ ...pendingPlannerTask, requestsNativeColdSession: true }],
          new RecoveryCooldown(0),
          10_000
        )
      ).toEqual([]);
    });

    it('wakes a pending native snapshot with no operational row and no presence', () => {
      // Offline agent: absent operational row (never reported) and no
      // participant/presence signal. Assignment alone makes it wake-eligible.
      registerTestNativeDeliverySession({
        runtime: undefined as never,
        effectContext: undefined as never,
        agentMgr: {} as never,
        sessionDeps: {} as never,
        machineId: 'machine-1',
        operationalRows: [],
      });

      const offlineTask = {
        ...pendingPlannerTask,
        participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
      };

      expect(
        listNativePendingTasksNeedingWake([offlineTask], new RecoveryCooldown(0), 10_000)
      ).toEqual([offlineTask]);
    });
  });
});
