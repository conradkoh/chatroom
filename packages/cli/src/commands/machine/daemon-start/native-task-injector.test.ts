import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runNativeInjectionEffect, type NativeInjectorDeps } from './native-task-injector.js';

const HARNESS_SESSION_ID = 'sess_1';

function makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'builder',
    taskContent: '## Goal\nDo work',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp/project',
      spawnedAgentPid: 12345,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

function createDeps(overrides?: Partial<NativeInjectorDeps>): NativeInjectorDeps {
  return {
    sessionId: 'session_1',
    machineId: 'machine_1',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ fullCliOutput: 'DELIVERY OUTPUT' }),
    },
    agentMgr: {
      resumeTurnForSlot: vi.fn().mockResolvedValue(undefined),
    },
    convexUrl: 'http://test:3210',
    ...overrides,
  };
}

describe('runNativeInjectionEffect', () => {
  test('claim → query → join → resumeTurn in order', async () => {
    const deps = createDeps();
    const task = makeTask();
    const order: string[] = [];

    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        if ('error' in args) order.push('failed');
        else if ('action' in args) order.push('join');
        else if ('mode' in args) order.push('augmented');
        else if ('machineId' in args && 'taskId' in args) order.push('delivered');
        else if ('taskId' in args && 'role' in args) order.push('claim');
        return undefined;
      }
    );
    (deps.backend.query as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('query');
      return { fullCliOutput: 'DELIVERY OUTPUT' };
    });
    (deps.agentMgr.resumeTurnForSlot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('resume');
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(order).toEqual(['claim', 'query', 'join', 'augmented', 'resume', 'delivered']);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });

  test('skips claim when task is already acknowledged', async () => {
    const deps = createDeps();
    const task = makeTask({
      status: 'acknowledged',
      assignedTo: 'builder',
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    const claimCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        'taskId' in call[1] &&
        !('action' in call[1]) &&
        !('machineId' in call[1])
    );
    expect(claimCalls).toHaveLength(0);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });

  test('emits taskDeliveryFailed when resumeTurn throws', async () => {
    const deps = createDeps({
      agentMgr: {
        resumeTurnForSlot: vi.fn().mockRejectedValue(new Error('resume failed')),
      },
    });
    const task = makeTask();

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    const failCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[1] === 'object' && call[1] !== null && 'error' in call[1]
    );
    expect(failCalls.length).toBeGreaterThan(0);
  });
});
