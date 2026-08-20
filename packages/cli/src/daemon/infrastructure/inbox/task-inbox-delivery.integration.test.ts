/** Task inbox → native delivery integration tests (mocked harness, no LLM). */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { handleTaskInboxUpdate } from './task-inbox-delivery.js';
import { clearAssignedTaskSnapshots } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from '../../entry/native-delivery/native-delivery-session-registry.js';
import { NudgeCooldown } from '../../entry/task-monitor/task-monitor-logic.js';

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
    spawnedAgentPid: 42,
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

describe('task inbox delivery integration', () => {
  afterEach(() => {
    clearAssignedTaskSnapshots();
    unregisterNativeDeliverySession();
    vi.clearAllMocks();
  });

  test('delivers a pending snapshot through the native coordinator', async () => {
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42,
        harnessSessionId: 'harness-1',
        nativeTurnPhase: 'idle',
      }),
      ensureRunning: vi.fn(),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    } as never;
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: { mutation: vi.fn(), query: vi.fn().mockResolvedValue({ taskContent: 'content' }) },
    } as never;
    const row = snapshot();
    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      {
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        cooldown: new NudgeCooldown(0),
        agentMgr,
        sessionDeps,
        machineId: 'machine-1',
      }
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalledOnce());
  });

  test('does not inject a replayed inbox snapshot twice', async () => {
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42,
        harnessSessionId: 'harness-1',
        nativeTurnPhase: 'idle',
      }),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    } as never;
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: { mutation: vi.fn(), query: vi.fn().mockResolvedValue({ taskContent: 'content' }) },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new NudgeCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    const row = snapshot();
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalledOnce());
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(runNativeInjectionEffect).toHaveBeenCalledOnce();
  });

  test('skips injection when backend ownership re-check fails', async () => {
    const agentMgr = {
      getSlot: vi
        .fn()
        .mockReturnValue({
          state: 'running',
          pid: 42,
          harnessSessionId: 'harness-1',
          nativeTurnPhase: 'idle',
        }),
      ensureRunning: vi.fn(),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    } as never;
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend: { mutation: vi.fn(), query: vi.fn().mockResolvedValue(null) },
    } as never;
    const row = snapshot();
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new NudgeCooldown(0),
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
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    } as never;
    const row = snapshot();
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
            'taskId' in args && 'role' in args ? full : { taskContent: 'content' }
          ),
      },
    } as never;
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new NudgeCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).toHaveBeenCalledOnce());
    expect(runNativeInjectionEffect).not.toHaveBeenCalled();
  });
});
