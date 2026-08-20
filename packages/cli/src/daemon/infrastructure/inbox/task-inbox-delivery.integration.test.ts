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
  participant: { lastSeenAction: undefined, lastSeenAt: undefined, lastStatus: undefined },
});

describe('task inbox delivery integration', () => {
  afterEach(() => {
    clearAssignedTaskSnapshots();
    unregisterNativeDeliverySession();
    vi.clearAllMocks();
  });

  test('delivers a pending snapshot through the native coordinator', async () => {
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
      backend: { mutation: vi.fn(), query: vi.fn().mockResolvedValue({ taskContent: 'content' }) },
    } as never;
    const row = snapshot();
    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime,
      effectContext: Context.empty(),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row], afterSignalKey: 'a', throughSignalKey: 'b' },
      {
        runtime: Runtime.defaultRuntime,
        effectContext: Context.empty(),
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
      getSlot: vi
        .fn()
        .mockReturnValue({
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
      runtime: Runtime.defaultRuntime,
      effectContext: Context.empty(),
      cooldown: new NudgeCooldown(0),
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    const row = snapshot();
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalledOnce());
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(runNativeInjectionEffect).toHaveBeenCalledOnce();
  });
});
