import { createTaskEnvelope } from '@workspace/shared/domain/task-envelope';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runNativeInjectionEffect, type NativeInjectorDeps } from './native-task-injector.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';

const HARNESS_SESSION_ID = 'sess_1';

function makeTask(overrides: Partial<AssignedTaskWithContent> = {}): AssignedTaskWithContent {
  return {
    taskId: 'task_1',
    chatroomId: 'room_1',
    status: 'pending',
    assignedTo: 'builder',
    taskContent: '## Goal\nDo work',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      model: 'composer-1',
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

function createAgentMgrMocks(
  overrides?: Partial<NativeInjectorDeps['agentMgr']>
): NativeInjectorDeps['agentMgr'] {
  return {
    resumeTurnForSlot: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ success: true }),
    ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
    getSlot: vi.fn().mockReturnValue({ harnessSessionId: 'sess_cold' }),
    ...overrides,
  };
}

function createDeps(overrides?: Partial<NativeInjectorDeps>): NativeInjectorDeps {
  return {
    sessionId: 'session_1',
    machineId: 'machine_1',
    logEvent: vi.fn().mockResolvedValue(undefined),
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ fullCliOutput: 'DELIVERY OUTPUT' }),
    },
    agentMgr: createAgentMgrMocks(),
    lifecycleOutbox: { enqueue: vi.fn().mockResolvedValue(undefined) },
    convexUrl: 'http://test:3210',
    ...overrides,
  };
}

describe('runNativeInjectionEffect', () => {
  test('claim → query → activity → receipt → resumeTurn in order', async () => {
    const deps = createDeps();
    const task = makeTask();
    const order: string[] = [];
    const auditOrder: string[] = [];
    (deps.lifecycleOutbox!.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('activity');
    });

    (deps.logEvent as ReturnType<typeof vi.fn>).mockImplementation(async (event) => {
      if (event.type === 'agent.sessionAugmented') auditOrder.push('augmented');
      if (event.type === 'agent.taskDelivered') auditOrder.push('delivered');
    });
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        if ('mode' in args) order.push('augmented-state');
        else if ('deliveryKind' in args) order.push('receipt');
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

    expect(order).toEqual(['claim', 'query', 'activity', 'receipt', 'augmented-state', 'resume']);
    expect(auditOrder).toEqual(['augmented', 'delivered']);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
    expect(deps.lifecycleOutbox!.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'activity',
        action: 'native:task-injected',
        taskId: 'task_1',
      })
    );
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
        !('machineId' in call[1]) &&
        !('deliveryKind' in call[1])
    );
    expect(claimCalls).toHaveLength(0);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });

  test('emits taskDeliveryFailed when resumeTurn throws', async () => {
    const deps = createDeps({
      agentMgr: createAgentMgrMocks({
        resumeTurnForSlot: vi.fn().mockRejectedValue(new Error('resume failed')),
      }),
    });
    const task = makeTask();

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(deps.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent.taskDeliveryFailed',
        error: 'resume failed',
      })
    );
  });

  test('startInNewSession cold-restarts before inject and emits sessionAugmented once', async () => {
    const deps = createDeps();
    const task = makeTask({
      startInNewSession: true,
      agentConfig: {
        ...makeTask().agentConfig,
        role: 'planner',
        model: 'composer-1',
      },
    });
    const augmentedCalls: Record<string, unknown>[] = [];
    const order: string[] = [];

    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        if ('mode' in args) {
          augmentedCalls.push(args);
          order.push('augmented');
        } else if ('action' in args) order.push('join');
        else if ('deliveryKind' in args) order.push('receipt');
        else if ('machineId' in args && 'taskId' in args && !('error' in args))
          order.push('delivered');
        else if ('taskId' in args && 'role' in args) order.push('claim');
        return undefined;
      }
    );
    (deps.agentMgr.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('stop');
      return { success: true };
    });
    (deps.agentMgr.ensureRunning as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('ensureRunning');
      return { success: true, pid: 12345 };
    });
    (deps.agentMgr.resumeTurnForSlot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('resume');
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(deps.agentMgr.stop).toHaveBeenCalled();
    expect(deps.agentMgr.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ wantResume: false, role: 'planner' })
    );
    expect(augmentedCalls).toHaveLength(1);
    expect(augmentedCalls[0]).toMatchObject({
      mode: 'new_session',
      newSessionStarted: true,
      harnessSessionId: 'sess_cold',
    });
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('augmented'));
    expect(order.indexOf('augmented')).toBeLessThan(order.indexOf('resume'));
  });

  test('regression: planner without startInNewSession resumes existing session without cold restart', async () => {
    const deps = createDeps();
    const task = makeTask({
      agentConfig: {
        ...makeTask().agentConfig,
        role: 'planner',
      },
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(deps.agentMgr.stop).not.toHaveBeenCalled();
    expect(deps.agentMgr.ensureRunning).not.toHaveBeenCalled();
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });

  test('explicit envelope new with scalar false still cold-restarts and emits augmentation', async () => {
    const deps = createDeps();
    const task = makeTask({
      taskEnvelope: createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' }),
      startInNewSession: false,
      agentConfig: {
        ...makeTask().agentConfig,
        role: 'planner',
        model: 'composer-1',
      },
    });
    const augmentedCalls: Record<string, unknown>[] = [];

    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        if ('mode' in args) augmentedCalls.push(args);
        return undefined;
      }
    );

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(deps.agentMgr.stop).toHaveBeenCalled();
    expect(deps.agentMgr.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ wantResume: false, role: 'planner' })
    );
    expect(augmentedCalls).toHaveLength(1);
    expect(augmentedCalls[0]).toMatchObject({
      mode: 'new_session',
      newSessionStarted: true,
      harnessSessionId: 'sess_cold',
    });
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });

  test('explicit envelope continue with scalar true does not cold-restart', async () => {
    const deps = createDeps();
    const task = makeTask({
      taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      startInNewSession: true,
      agentConfig: {
        ...makeTask().agentConfig,
        role: 'planner',
      },
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps));

    expect(deps.agentMgr.stop).not.toHaveBeenCalled();
    expect(deps.agentMgr.ensureRunning).not.toHaveBeenCalled();
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
  });
});
