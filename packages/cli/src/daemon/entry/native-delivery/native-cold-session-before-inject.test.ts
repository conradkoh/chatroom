import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { createTaskEnvelope } from '@workspace/shared/domain/task-envelope';
import { describe, expect, test, vi } from 'vitest';

import { ensureColdSessionBeforeNativeInject } from './native-cold-session-before-inject.js';
import type { NativeInjectorDeps } from './native-task-injector.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';

function makeTask(overrides: Partial<AssignedTaskWithContent> = {}): AssignedTaskWithContent {
  return {
    taskId: 'task_1',
    chatroomId: 'room_1',
    status: 'pending',
    assignedTo: 'planner',
    taskContent: '## Goal\nUser task',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'planner',
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

function createDeps(overrides?: Partial<NativeInjectorDeps>): NativeInjectorDeps {
  return {
    sessionId: 'session_1',
    machineId: 'machine_1',
    logEvent: vi.fn().mockResolvedValue(undefined),
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    },
    agentMgr: {
      resumeTurnForSlot: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ success: true }),
      ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 99_001 }),
      getSlot: vi.fn().mockReturnValue({ state: 'running', harnessSessionId: 'sess_after_cold' }),
    },
    ...overrides,
  };
}

describe('ensureColdSessionBeforeNativeInject', () => {
  test('returns null when startInNewSession is not set', async () => {
    const deps = createDeps();
    const result = await ensureColdSessionBeforeNativeInject(makeTask(), deps);

    expect(result).toBeNull();
    expect(deps.agentMgr.stop).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  test('cold-restarts planner harness and emits sessionAugmented before returning session id', async () => {
    const deps = createDeps();
    const task = makeTask({ startInNewSession: true });
    const mutationCalls: { fn: unknown; args: Record<string, unknown> }[] = [];

    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ fn, args });
        return undefined;
      }
    );

    const result = await ensureColdSessionBeforeNativeInject(task, deps);

    expect(result).toBe('sess_after_cold');
    expect(deps.agentMgr.stop).toHaveBeenCalledWith({
      chatroomId: 'room_1',
      role: 'planner',
      reason: 'platform.task_start_in_new_session',
    });
    expect(deps.agentMgr.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room_1',
        role: 'planner',
        wantResume: false,
        reason: 'platform.task_start_in_new_session',
      })
    );

    const waitingJoin = mutationCalls.find((call) => call.args.action === NATIVE_WAITING_ACTION);
    expect(waitingJoin?.args).toMatchObject({
      chatroomId: 'room_1',
      role: 'planner',
      taskId: 'task_1',
    });

    const augmented = mutationCalls.find((call) => call.args.mode === 'new_session');
    expect(augmented?.args).toMatchObject({
      chatroomId: 'room_1',
      role: 'planner',
      taskId: 'task_1',
      mode: 'new_session',
      newSessionStarted: true,
      harnessSessionId: 'sess_after_cold',
    });
  });

  test('returns null when cold spawn fails', async () => {
    const deps = createDeps({
      agentMgr: {
        ...createDeps().agentMgr,
        ensureRunning: vi.fn().mockResolvedValue({ success: false }),
      },
    });

    const result = await ensureColdSessionBeforeNativeInject(
      makeTask({ startInNewSession: true }),
      deps
    );

    expect(result).toBeNull();
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  test('explicit envelope new plus stale scalar false cold-restarts', async () => {
    const deps = createDeps();
    const task = makeTask({
      taskEnvelope: createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' }),
      startInNewSession: false,
    });

    const result = await ensureColdSessionBeforeNativeInject(task, deps);

    expect(result).toBe('sess_after_cold');
    expect(deps.agentMgr.stop).toHaveBeenCalledWith({
      chatroomId: 'room_1',
      role: 'planner',
      reason: 'platform.task_start_in_new_session',
    });
    expect(deps.agentMgr.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ wantResume: false, reason: 'platform.task_start_in_new_session' })
    );
  });

  test('explicit envelope continue plus stale scalar true does not cold-restart', async () => {
    const deps = createDeps();
    const task = makeTask({
      taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      startInNewSession: true,
    });

    const result = await ensureColdSessionBeforeNativeInject(task, deps);

    expect(result).toBeNull();
    expect(deps.agentMgr.stop).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});
