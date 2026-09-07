/**
 * Real coordinator → injector → cold-helper pipeline for explicit cold-session
 * tasks after daemon restart.
 *
 * Unlike the mocked routing test, this keeps the injector and cold-session
 * helper real with a stateful process-manager fake: missing slot +
 * operational `starting` must yield zero revive/wake starts, one cold
 * `ensureRunning(wantResume: false)`, zero stops, one resume, a real receipt
 * id, and clean attempt state.
 */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { handleLegacyTaskInboxUpdate as handleTaskInboxUpdate } from './legacy-task-inbox-delivery.js';
import {
  getNativeDeliveryLedger,
  resetNativeDeliveryLedgerForTests,
} from '../../entry/native-delivery/native-delivery-ledger.js';
import { unregisterNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../agent-operational/test-support.js';

const snapshot = () => ({
  taskId: 'task-cold-1' as never,
  chatroomId: 'room-1' as never,
  status: 'pending' as const,
  assignedTo: 'builder',
  updatedAt: 100,
  createdAt: 100,
  requestsNativeColdSession: true,
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
    taskContent: 'cold session task',
    startInNewSession: true,
    agentConfig: { ...row.agentConfig, model: 'composer-1' },
  };
}

function createStatefulAgentMgr() {
  const slots = new Map<string, Record<string, unknown>>();
  const stopCalls: unknown[] = [];
  const ensureRunningCalls: unknown[] = [];
  const resumeCalls: unknown[] = [];
  const key = (chatroomId: string, role: string) => `${chatroomId}:${role.toLowerCase()}`;
  return {
    stopCalls,
    ensureRunningCalls,
    resumeCalls,
    slots,
    getSlot: vi.fn((chatroomId: string, role: string) => slots.get(key(chatroomId, role))),
    stop: vi.fn((opts: { chatroomId: string; role: string }) =>
      Effect.sync(() => {
        stopCalls.push(opts);
        return { success: true };
      })
    ),
    ensureRunning: vi.fn((opts: { chatroomId: string; role: string; wantResume: boolean }) =>
      Effect.sync(() => {
        ensureRunningCalls.push(opts);
        slots.set(key(opts.chatroomId, opts.role), {
          state: 'running',
          pid: 99_001,
          harnessSessionId: 'harness-fresh',
          nativeTurnPhase: 'idle',
        });
        return { success: true, pid: 99_001 };
      })
    ),
    clearStuckStoppingSlot: vi.fn().mockResolvedValue(false),
    resumeTurnForSlot: vi.fn((args: { chatroomId: string; role: string; prompt: string }) => {
      resumeCalls.push(args);
      return Effect.void;
    }),
  } as never;
}

describe('cold-session real pipeline', () => {
  afterEach(() => {
    unregisterNativeDeliverySession();
    resetNativeDeliveryLedgerForTests();
    vi.clearAllMocks();
  });

  test('daemon restart delivers explicit cold task with one cold spawn and no revive', async () => {
    const agentMgr = createStatefulAgentMgr();
    const row = snapshot();
    const full = fullTaskFromSnapshot(row);
    const receipts: unknown[] = [];
    const backend = {
      mutation: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
        receipts.push(args);
        return { success: true };
      }),
      query: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
        if ('convexUrl' in args) return { fullCliOutput: 'DELIVERY OUTPUT' };
        return full;
      }),
    };
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend,
    } as never;
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'starting')],
    });
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => {
      expect(
        (agentMgr as unknown as { resumeCalls: unknown[] }).resumeCalls.length
      ).toBeGreaterThanOrEqual(1);
    });

    const mgr = agentMgr as unknown as {
      ensureRunningCalls: { wantResume: boolean; reason: string }[];
      stopCalls: unknown[];
      resumeCalls: unknown[];
    };
    // Delivery owns the cold start: exactly one spawn, fresh session, no stop
    // for a missing slot.
    expect(mgr.ensureRunningCalls).toHaveLength(1);
    expect(mgr.ensureRunningCalls[0]).toMatchObject({ wantResume: false });
    expect(mgr.ensureRunningCalls[0]?.reason).toBe('platform.task_start_in_new_session');
    expect(mgr.stopCalls).toHaveLength(0);
    expect(mgr.resumeCalls).toHaveLength(1);
    // Receipt recorded against the real resolved session, never a placeholder.
    const receipt = receipts.find(
      (r) => typeof r === 'object' && r !== null && 'harnessSessionId' in r
    ) as { harnessSessionId: string } | undefined;
    expect(receipt?.harnessSessionId).toBe('harness-fresh');
    // Attempt state is clean after success; a duplicate pass cannot re-acquire
    // without a new attempt.
    expect(getNativeDeliveryLedger().isAttemptInFlight('task-cold-1')).toBe(false);
    expect(getNativeDeliveryLedger().isDelivered('task-cold-1', 'harness-fresh')).toBe(true);
  });

  test('running old session cold-replaces with one successful stop then one start', async () => {
    const agentMgr = createStatefulAgentMgr();
    (agentMgr as unknown as { slots: Map<string, Record<string, unknown>> }).slots.set(
      'room-1:builder',
      {
        state: 'running',
        pid: 41,
        harnessSessionId: 'harness-old',
        nativeTurnPhase: 'idle',
      }
    );
    // ensureRunning replaces the old session id.
    (agentMgr as unknown as { ensureRunning: ReturnType<typeof vi.fn> }).ensureRunning = vi.fn(
      (opts: { chatroomId: string; role: string }) => {
        const mgr = agentMgr as unknown as {
          ensureRunningCalls: unknown[];
          slots: Map<string, Record<string, unknown>>;
        };
        mgr.ensureRunningCalls.push(opts);
        mgr.slots.set('room-1:builder', {
          state: 'running',
          pid: 99_002,
          harnessSessionId: 'harness-fresh-2',
          nativeTurnPhase: 'idle',
        });
        return Effect.succeed({ success: true, pid: 99_002 });
      }
    ) as never;
    const row = snapshot();
    const full = fullTaskFromSnapshot(row);
    const backend = {
      mutation: vi.fn().mockResolvedValue({ success: true }),
      query: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
        if ('convexUrl' in args) return { fullCliOutput: 'DELIVERY OUTPUT' };
        return full;
      }),
    };
    const sessionDeps = {
      sessionId: 'session-1',
      convexUrl: 'http://test',
      machineId: 'machine-1',
      logEvent: vi.fn(),
      backend,
    } as never;
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'running')],
    });
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: 'machine-1',
    };
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => {
      expect(
        (agentMgr as unknown as { resumeCalls: unknown[] }).resumeCalls.length
      ).toBeGreaterThanOrEqual(1);
    });
    const mgr = agentMgr as unknown as { stopCalls: unknown[]; ensureRunningCalls: unknown[] };
    expect(mgr.stopCalls).toHaveLength(1);
    expect(mgr.ensureRunningCalls).toHaveLength(1);
    expect(getNativeDeliveryLedger().isDelivered('task-cold-1', 'harness-fresh-2')).toBe(true);
    // Old session record is distinct from the fresh delivery.
    expect(getNativeDeliveryLedger().isDelivered('task-cold-1', 'harness-old')).toBe(false);
  });
});
