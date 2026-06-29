import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { resolveSessionAugmentationForRole } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  buildNativeInjectionPrompt,
  shouldDeliverNativeTask,
} from './native-task-injector-logic.js';
import { runNativeInjectionEffect, type NativeInjectorDeps } from './native-task-injector.js';
import { api } from '../../../api.js';

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
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();
    const calls: string[] = [];

    let mutationCall = 0;
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        mutationCall += 1;
        if (mutationCall === 1) calls.push('claim');
        if (args.action === NATIVE_TASK_INJECTED_ACTION) calls.push('join');
      }
    );
    (deps.backend.query as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('query');
      return { fullCliOutput: 'DELIVERY OUTPUT' };
    });
    (deps.agentMgr.resumeTurnForSlot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('resumeTurn');
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    expect(calls).toEqual(['claim', 'query', 'join', 'resumeTurn']);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: task.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForRole(
          task.taskContent,
          task.agentConfig.role
        ),
      }),
    });
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      api.participants.join,
      expect.objectContaining({
        action: NATIVE_TASK_INJECTED_ACTION,
        taskId: task.taskId,
      })
    );
    expect(ledger.isDelivered(task.taskId, HARNESS_SESSION_ID)).toBe(true);
  });

  test('skips when shouldDeliverNativeTask is false', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({ status: 'in_progress' });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(deps.agentMgr.resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('skips claim when task is already acknowledged', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({
      status: 'acknowledged',
      assignedTo: 'builder',
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    const claimCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === api.tasks.claimTask
    );
    expect(claimCalls).toHaveLength(0);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalled();
    expect(ledger.isDelivered(task.taskId, HARNESS_SESSION_ID)).toBe(true);
  });

  test('concurrent injection only claims once', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();
    let claimCount = 0;

    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fn: unknown, args: Record<string, unknown>) => {
        if (!('action' in args) && args.taskId && !('machineId' in args)) {
          claimCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return undefined;
      }
    );
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      fullCliOutput: 'DELIVERY OUTPUT',
    });

    await Promise.all([
      Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger)),
      Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger)),
    ]);

    expect(claimCount).toBe(1);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalledTimes(1);
    expect(ledger.isDelivered(task.taskId, HARNESS_SESSION_ID)).toBe(true);
  });

  test('clears ledger and logs warning when resumeTurn throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = createDeps({
      agentMgr: {
        resumeTurnForSlot: vi.fn().mockRejectedValue(new Error('resume failed')),
      },
    });
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    expect(ledger.isDelivered(task.taskId, HARNESS_SESSION_ID)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('planner task does not emit sessionAugmented or new-session preamble', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({
      agentConfig: { ...makeTask().agentConfig, role: 'planner' },
      taskContent: '## Goal\nAck user task',
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    const emitCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === api.machines.emitSessionAugmented
    );
    expect(emitCalls).toHaveLength(0);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'DELIVERY OUTPUT',
      })
    );
  });

  test('regression: planner acknowledged task (user ack) does not emit sessionAugmented', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({
      status: 'acknowledged',
      assignedTo: 'planner',
      agentConfig: { ...makeTask().agentConfig, role: 'planner' },
      taskContent: `## Goal
Review and acknowledge the user task.

## Task
Ship feature A`,
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    const emitCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === api.machines.emitSessionAugmented
    );
    expect(emitCalls).toHaveLength(0);
    const prompt = (deps.agentMgr.resumeTurnForSlot as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).not.toContain('Starting a new agent session');
    expect(prompt).not.toContain('Context was compacted');
  });

  test('regression: planner builder handback does not emit sessionAugmented with newSessionStarted', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({
      assignedTo: 'planner',
      agentConfig: { ...makeTask().agentConfig, role: 'planner' },
      taskContent: `## Summary
Implemented dark mode toggle.

## Changes Made
- Added theme switch`,
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    const emitCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === api.machines.emitSessionAugmented
    );
    expect(emitCalls).toHaveLength(0);
  });

  test('regression: builder delegation without section emits newSessionStarted=true', async () => {
    const deps = createDeps();
    const ledger = new NativeDeliveryLedger();
    const task = makeTask({
      taskContent: `## Goal
Add dark mode toggle

## Files to implement
- src/theme.ts`,
    });

    await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      api.machines.emitSessionAugmented,
      expect.objectContaining({
        role: 'builder',
        mode: 'new_session',
        newSessionStarted: true,
      })
    );
    const prompt = (deps.agentMgr.resumeTurnForSlot as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).toContain('Starting a new agent session');
  });

  test('emits sessionAugmented for every session_augmentation mode', async () => {
    for (const tag of ['none', 'compact', 'new_session'] as const) {
      const deps = createDeps();
      const ledger = new NativeDeliveryLedger();
      const task = makeTask({
        taskContent: `## Goal\nDo work\n## Session Augmentation\n// data:agent.session_augmentation=${tag}`,
      });

      await Effect.runPromise(runNativeInjectionEffect(task, HARNESS_SESSION_ID, deps, ledger));

      expect(deps.backend.mutation).toHaveBeenCalledWith(
        api.machines.emitSessionAugmented,
        expect.objectContaining({
          sessionId: 'session_1',
          machineId: 'machine_1',
          chatroomId: task.chatroomId,
          role: 'builder',
          taskId: task.taskId,
          mode: tag,
          newSessionStarted: tag === 'new_session',
          harnessSessionId: HARNESS_SESSION_ID,
        })
      );
    }
  });
});

describe('shouldDeliverNativeTask integration with ledger', () => {
  test('deliver once per taskId per harness session across duplicate events', () => {
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();
    expect(shouldDeliverNativeTask(task, { ledger, harnessSessionId: HARNESS_SESSION_ID })).toBe(
      true
    );
    ledger.markDelivered(task.taskId, HARNESS_SESSION_ID);
    expect(shouldDeliverNativeTask(task, { ledger, harnessSessionId: HARNESS_SESSION_ID })).toBe(
      false
    );
  });
});
