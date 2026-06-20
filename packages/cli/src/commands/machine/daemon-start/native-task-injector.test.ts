import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  buildNativeInjectionPrompt,
  NativeInjectionDedup,
  shouldInjectNativeTask,
} from './native-task-injector-logic.js';
import { runNativeInjectionEffect, type NativeInjectorDeps } from './native-task-injector.js';
import { api } from '../../../api.js';

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
  test('claim → query → resumeTurn → join in order', async () => {
    const deps = createDeps();
    const dedup = new NativeInjectionDedup();
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

    await Effect.runPromise(runNativeInjectionEffect(task, deps, dedup));

    expect(calls).toEqual(['claim', 'query', 'resumeTurn', 'join']);
    expect(deps.agentMgr.resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: task.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'DELIVERY OUTPUT',
        taskContent: task.taskContent,
        compressMode: parseCompressContext(task.taskContent),
      }),
    });
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      api.participants.join,
      expect.objectContaining({
        action: NATIVE_TASK_INJECTED_ACTION,
        taskId: task.taskId,
      })
    );
    expect(dedup.has(task.taskId)).toBe(true);
  });

  test('skips when shouldInjectNativeTask is false', async () => {
    const deps = createDeps();
    const dedup = new NativeInjectionDedup();
    const task = makeTask({ status: 'in_progress' });

    await Effect.runPromise(runNativeInjectionEffect(task, deps, dedup));

    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(deps.agentMgr.resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('clears dedup and logs warning when resumeTurn throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = createDeps({
      agentMgr: {
        resumeTurnForSlot: vi.fn().mockRejectedValue(new Error('resume failed')),
      },
    });
    const dedup = new NativeInjectionDedup();
    const task = makeTask();

    await Effect.runPromise(runNativeInjectionEffect(task, deps, dedup));

    expect(dedup.has(task.taskId)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('shouldInjectNativeTask integration with dedup', () => {
  test('inject once per taskId across duplicate events', () => {
    const dedup = new NativeInjectionDedup();
    const task = makeTask();
    expect(shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })).toBe(true);
    dedup.markInjected(task.taskId);
    expect(shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })).toBe(false);
  });
});
