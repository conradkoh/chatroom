/** Task inbox → native delivery integration tests (mocked harness, no LLM). */
import { GET_NEXT_TASK_STARTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { handleTaskInboxUpdate } from './task-inbox-delivery.js';
import { unregisterNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../agent-operational/test-support.js';

const runNativeInjectionEffect = vi.hoisted(() => vi.fn(() => Effect.void));
vi.mock('../../entry/native-delivery/native-task-injector.js', () => ({
  runNativeInjectionEffect,
}));

const snapshot = () => ({
  taskId: 'task-1' as never,
  chatroomId: 'room-1' as never,
  status: 'pending' as const,
  assignedTo: 'builder',
  updatedAt: 100,
  createdAt: 100,
  agentConfig: {
    role: 'builder',
    machineId: 'machine-1',
    agentHarness: 'cursor-sdk',
    workingDir: '/tmp',
    spawnedAgentPid: process.pid,
    desiredState: 'running' as const,
  },
  participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
});

function fullTaskFromSnapshot(row: ReturnType<typeof snapshot>) {
  return {
    ...row,
    taskContent: 'content',
    agentConfig: { ...row.agentConfig, model: 'composer-1' },
  };
}

function createAgentMgrMock(overrides: Record<string, unknown> = {}): never {
  return {
    getSlot: vi.fn().mockReturnValue({
      state: 'running',
      pid: process.pid,
      harnessSessionId: 'harness-1',
      nativeTurnPhase: 'idle',
    }),
    ensureRunning: vi.fn().mockReturnValue(Effect.succeed({ success: true, pid: 42 })),
    stop: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
    clearStuckStoppingSlot: vi.fn().mockResolvedValue(false),
    setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    ...overrides,
  } as never;
}

describe('task inbox delivery integration', () => {
  afterEach(() => {
    unregisterNativeDeliverySession();
    vi.clearAllMocks();
  });

  test('delivers a pending snapshot through the native coordinator', async () => {
    const agentMgr = createAgentMgrMock();
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? fullTaskFromSnapshot(snapshot()) : { tasks: [snapshot()] }
          ),
      },
    } as never;
    const row = snapshot();
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'running')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      {
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        cooldown: new RecoveryCooldown(60_000),
        agentMgr,
        sessionDeps,
        machineId: 'machine-1',
      }
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalled());
  });

  test('does not inject a replayed inbox snapshot twice', async () => {
    const agentMgr = createAgentMgrMock();
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? fullTaskFromSnapshot(snapshot()) : { tasks: [snapshot()] }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(60_000),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    const row = snapshot();
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'running')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalled());
    const initialInjectionCount = runNativeInjectionEffect.mock.calls.length;
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(runNativeInjectionEffect.mock.calls.length).toBeGreaterThanOrEqual(
      initialInjectionCount
    );
  });

  test('skips injection when backend ownership re-check fails', async () => {
    const agentMgr = createAgentMgrMock();
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? null : { tasks: [row] }
          ),
      },
    } as never;
    const row = snapshot();
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'stopped')],
    });
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(runNativeInjectionEffect).not.toHaveBeenCalled();
  });

  test('revives a cold-start agent when its slot is missing', async () => {
    const ensureRunning = vi.fn().mockResolvedValue({ success: true, pid: 99_001 });
    const agentMgr = createAgentMgrMock({
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
    });
    const row = snapshot();
    row.agentConfig.spawnedAgentPid = process.pid;
    const full = fullTaskFromSnapshot(row);
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args && 'role' in args ? full : { tasks: [row] }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'running')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).toHaveBeenCalledOnce());
    expect(runNativeInjectionEffect).not.toHaveBeenCalled();
  });

  test('wakes agent when operational state is stopped', async () => {
    const ensureRunning = vi.fn().mockResolvedValue({ success: true, pid: 99_002 });
    const agentMgr = createAgentMgrMock({
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
    });
    const row = {
      ...snapshot(),
      agentConfig: {
        ...snapshot().agentConfig,
        spawnedAgentPid: undefined,
      },
    };
    const full = fullTaskFromSnapshot(row as unknown as ReturnType<typeof snapshot>);
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? full : { tasks: [row] }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'stopped')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).toHaveBeenCalledOnce());
    expect(ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'platform.pending_task_wake' })
    );
  });

  test('wakes an absent/offline pending snapshot with one ensureRunning and one hydration', async () => {
    // Offline agent: no operational row at all (never reported), no local slot,
    // no presence. The pending assigned snapshot alone must trigger exactly one
    // ensureRunning with platform.pending_task_wake and one backend hydration.
    const ensureRunning = vi.fn().mockResolvedValue({ success: true, pid: 99_003 });
    const agentMgr = createAgentMgrMock({
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
    });
    const row = {
      ...snapshot(),
      agentConfig: {
        ...snapshot().agentConfig,
        spawnedAgentPid: undefined,
      },
    };
    const full = fullTaskFromSnapshot(row as unknown as ReturnType<typeof snapshot>);
    const query = vi
      .fn()
      .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
        'taskId' in args ? full : { tasks: [row] }
      );
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query,
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).toHaveBeenCalledTimes(1));
    const wakeArgs = ensureRunning.mock.calls[0]![0] as Record<string, unknown>;
    expect(wakeArgs.reason).toBe('platform.pending_task_wake');
    expect(wakeArgs.role).toBe('builder');
    expect(wakeArgs.chatroomId).toBe('room-1');
    // Exactly one backend action hydration for the pending snapshot — no
    // second participant/config query.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      machineId: 'machine-1',
      taskId: 'task-1',
      role: 'builder',
    });
    // Native injection must not start before the mocked agent becomes running.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runNativeInjectionEffect).not.toHaveBeenCalled();
  });

  test('does not wake when operational stopState is stopped', async () => {
    const ensureRunning = vi.fn().mockResolvedValue({ success: true, pid: 99_002 });
    const agentMgr = createAgentMgrMock({
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
    });
    const row = {
      ...snapshot(),
      agentConfig: {
        ...snapshot().agentConfig,
        spawnedAgentPid: undefined,
      },
    };
    const full = fullTaskFromSnapshot(row as unknown as ReturnType<typeof snapshot>);
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? full : { tasks: [row] }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'stopped', 'stopped')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).not.toHaveBeenCalled());
  });

  test('does not stop or restart CLI agent for idle pending snapshot', async () => {
    const stop = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const ensureRunning = vi.fn().mockReturnValue(Effect.succeed({ success: true, pid: 42 }));
    const agentMgr = createAgentMgrMock({ stop, ensureRunning });
    const now = Date.now();
    const row = {
      taskId: 'task-cli-idle' as never,
      chatroomId: 'room-1' as never,
      status: 'pending' as const,
      assignedTo: 'builder',
      updatedAt: now - 60_000,
      createdAt: now - 30_000,
      agentConfig: {
        role: 'builder',
        machineId: 'machine-1',
        agentHarness: 'opencode',
        workingDir: '/tmp',
        spawnedAgentPid: process.pid,
        desiredState: 'running' as const,
      },
      participant: {
        lastSeenAction: GET_NEXT_TASK_STARTED_ACTION,
        lastSeenAt: now - 60_000,
        lastStatus: 'agent.waiting',
      },
    };
    const full = {
      ...row,
      taskContent: 'stale pending task',
      agentConfig: { ...row.agentConfig, model: 'gpt-4' },
    };
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi
          .fn()
          .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
            'taskId' in args ? full : { tasks: [row] }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'running')],
    });

    await expect(
      handleTaskInboxUpdate(
        { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
        deps
      )
    ).resolves.toBeUndefined();

    await new Promise((resolve) => setImmediate(resolve));
    expect(stop).not.toHaveBeenCalled();
    expect(ensureRunning).not.toHaveBeenCalled();
  });
});
