/**
 * Deterministic tests for the canonical task orchestration coordinator.
 *
 * All collaborators are injected fakes (process port, backend, read models);
 * deferred barriers control drain overlap so coalescing, concurrency, and stop
 * behavior are asserted without timers.
 */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createTaskOrchestrationCoordinator,
  type TaskOrchestrationCoordinatorDeps,
  type TaskOrchestrationProcessPort,
  type TaskOrchestrationSessionDeps,
} from './task-orchestration-coordinator.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../domain/entities/assigned-task.js';
import {
  AgentOperationalReadModel,
  type MachineAgentOperationalRow,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { OperationalInboxUpdate } from '../../infrastructure/agent-operational/operational-inbox.js';
import type {
  AgentSlot,
  EnsureRunningOpts,
  OperationResult,
} from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type { TaskInboxUpdate } from '../../infrastructure/inbox/task.js';
import {
  getNativeDeliveryLedger,
  resetNativeDeliveryLedgerForTests,
} from '../native-delivery/native-delivery-ledger.js';
import {
  _resetRestartOrchestratorInFlightForTests,
  markRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';
import { RecoveryCooldown } from '../task-delivery/task-delivery-logic.js';

let roomSeq = 0;
function nextRoom(): string {
  roomSeq += 1;
  return `room_orch_${roomSeq}`;
}

function makeRow(
  overrides?: Partial<AssignedTaskSnapshotView> & { role?: string }
): AssignedTaskSnapshotView {
  const role = overrides?.role ?? 'builder';
  const { role: _ignored, ...rest } = overrides ?? {};
  return {
    taskId: 'task_1',
    chatroomId: 'room_x',
    status: 'pending',
    assignedTo: role,
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role,
      machineId: 'm',
      agentHarness: 'cursor-sdk',
      model: 'model-x',
      workingDir: '/test',
      spawnedAgentPid: 42_424,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'agent.waiting',
    },
    ...rest,
  } as AssignedTaskSnapshotView;
}

function makeFull(row: AssignedTaskSnapshotView): AssignedTaskWithContent {
  return { ...row, taskContent: 'do the thing', taskEnvelope: undefined, startInNewSession: false };
}

function makeOperational(
  chatroomId: string,
  role: string,
  overrides?: Partial<MachineAgentOperationalRow>
): MachineAgentOperationalRow {
  return {
    chatroomId,
    role,
    operationalState: 'running',
    isAlive: true,
    isRunning: true,
    daemonConnected: true,
    revisionKey: `rev_${chatroomId}_${role}`,
    ...overrides,
  };
}

function makeTaskInboxUpdate(
  signals: TaskInboxUpdate['signals'],
  snapshots: readonly AssignedTaskSnapshotView[]
): TaskInboxUpdate {
  return { signals, snapshots, afterSignalKey: 'a', throughSignalKey: 'b' };
}

function makeTaskSignal(
  chatroomId: string,
  taskId: string,
  targetRole: string,
  taskStatus: TaskInboxUpdate['signals'][number]['taskStatus'],
  signalKey: string
): TaskInboxUpdate['signals'][number] {
  return {
    chatroomId: chatroomId as never,
    taskId: taskId as never,
    targetRole,
    taskStatus,
    signalKey,
    taskUpdatedAt: 1_700_000_000_000,
  };
}

function makeOperationalInboxUpdate(
  chatroomId: string,
  rows: readonly MachineAgentOperationalRow[],
  removed: readonly { chatroomId: string; role: string }[] = []
): OperationalInboxUpdate {
  return {
    chatroomId,
    signals: rows.map(
      (row) =>
        ({
          chatroomId: row.chatroomId,
          role: row.role,
          revisionKey: row.revisionKey,
          signalKey: `sig:${row.revisionKey}`,
          projectedAt: 1_700_000_000_000,
          removed: false,
        }) as OperationalInboxUpdate['signals'][number]
    ),
    rows,
    removed,
    afterSignalKey: 'a',
    throughSignalKey: 'b',
  };
}

interface FakeProcess extends TaskOrchestrationProcessPort {
  slots: Map<string, AgentSlot>;
  ensureRunningCalls: EnsureRunningOpts[];
  resumeCalls: { chatroomId: string; role: string; prompt: string }[];
  setLastInFlightCalls: { chatroomId: string; role: string; taskId: string }[];
  clearLastInFlightCalls: { chatroomId: string; role: string; taskId: string }[];
  clearStuckCalls: { chatroomId: string; role: string; clearStopIntent: boolean }[];
  reconcileTurnCalls: { chatroomId: string; role: string }[];
}

function slotKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

function createFakeProcess(opts?: {
  ensureRunningImpl?: (opts: EnsureRunningOpts) => Effect.Effect<OperationResult, unknown, unknown>;
}): FakeProcess {
  const fake: FakeProcess = {
    slots: new Map(),
    ensureRunningCalls: [],
    resumeCalls: [],
    setLastInFlightCalls: [],
    clearLastInFlightCalls: [],
    clearStuckCalls: [],
    reconcileTurnCalls: [],
    getSlot: (chatroomId, role) => fake.slots.get(slotKey(chatroomId, role)),
    clearStuckStoppingSlot: async (chatroomId, role, options) => {
      fake.clearStuckCalls.push({ chatroomId, role, clearStopIntent: options.clearStopIntent });
      return false;
    },
    ensureRunning: (op) =>
      Effect.sync(() => {
        fake.ensureRunningCalls.push(op);
      }).pipe(
        Effect.flatMap(() =>
          opts?.ensureRunningImpl ? opts.ensureRunningImpl(op) : Effect.succeed({ success: true })
        )
      ) as Effect.Effect<OperationResult>,
    stop: () => Effect.succeed({ success: true }),
    resumeTurnForSlot: (args) =>
      Effect.sync(() => {
        fake.resumeCalls.push(args);
      }),
    setLastInFlightTask: (chatroomId, role, taskId) =>
      Effect.sync(() => {
        fake.setLastInFlightCalls.push({ chatroomId, role, taskId });
      }),
    clearLastInFlightTaskIfMatches: (chatroomId, role, taskId) =>
      Effect.sync(() => {
        fake.clearLastInFlightCalls.push({ chatroomId, role, taskId });
      }),
    reconcileNativeTurnPhaseIdle: (chatroomId, role) =>
      Effect.sync(() => {
        fake.reconcileTurnCalls.push({ chatroomId, role });
        const slot = fake.slots.get(slotKey(chatroomId, role));
        if (slot) slot.nativeTurnPhase = 'idle';
      }),
  };
  return fake;
}

function createFakeBackend(fullByTaskId: Map<string, AssignedTaskWithContent>) {
  const queryCalls: { fn: unknown; args: Record<string, unknown> }[] = [];
  const mutationCalls: { fn: unknown; args: Record<string, unknown> }[] = [];
  const queryImpl: (((fn: unknown, args: Record<string, unknown>) => Promise<unknown>) | null)[] = [
    null,
  ];
  const backend = {
    queryCalls,
    mutationCalls,
    setQueryImpl: (impl: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>) => {
      queryImpl[0] = impl;
    },
    query: async (fn: unknown, args: Record<string, unknown>): Promise<unknown> => {
      queryCalls.push({ fn, args });
      if (queryImpl[0]) return queryImpl[0](fn, args);
      // NOTE: the generated Convex `api` is a Proxy (`anyApi`), so function
      // references are not stable across property accesses. Route on args
      // shape instead of `fn` identity (mirrors legacy coordinator tests).
      if ('convexUrl' in args && 'taskId' in args) {
        return { fullCliOutput: 'DELIVERY OUTPUT' };
      }
      if ('taskId' in args) {
        const taskId = String((args as { taskId: string }).taskId);
        return fullByTaskId.get(taskId) ?? null;
      }
      throw new Error(`Unexpected query: ${JSON.stringify(args)}`);
    },
    mutation: async (fn: unknown, args: Record<string, unknown>): Promise<unknown> => {
      mutationCalls.push({ fn, args });
      return undefined;
    },
  };
  return backend;
}

function setupCoordinator(opts?: {
  process?: FakeProcess;
  backend?: ReturnType<typeof createFakeBackend>;
  cooldownMs?: number;
  outbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
}) {
  const taskSnapshotState = new MachineTaskSnapshotState();
  const agentOperationalReadModel = new AgentOperationalReadModel();
  const cooldown = new RecoveryCooldown(opts?.cooldownMs ?? 0);
  const process = opts?.process ?? createFakeProcess();
  const backend = opts?.backend ?? createFakeBackend(new Map());
  const enqueue = vi.fn(async (_fact: AgentLifecycleFact) => undefined);
  const sessionDeps: TaskOrchestrationSessionDeps = {
    sessionId: 'sess',
    machineId: 'm',
    convexUrl: 'http://x',
    logEvent: async () => undefined,
    backend: { query: backend.query, mutation: backend.mutation },
  };
  const coordinator = createTaskOrchestrationCoordinator({
    runtime: Runtime.defaultRuntime as unknown as TaskOrchestrationCoordinatorDeps['runtime'],
    effectContext: Context.empty() as unknown as TaskOrchestrationCoordinatorDeps['effectContext'],
    sessionDeps,
    process,
    runSerializedForAgent: async (_key, _options, operation) =>
      operation(
        {
          startAgent: async (input) => Effect.runPromise(process.ensureRunning(input)),
          stopAgent: async (input) => Effect.runPromise(process.stop(input)),
        },
        { signal: new AbortController().signal }
      ),
    taskSnapshotState,
    agentOperationalReadModel,
    cooldown,
    lifecycleOutbox: opts?.outbox ?? { enqueue },
    isPidAlive: () => true,
  });
  return {
    coordinator,
    taskSnapshotState,
    agentOperationalReadModel,
    cooldown,
    process,
    backend,
    enqueue,
  };
}

function silenceConsole(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('task-orchestration-coordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetNativeDeliveryLedgerForTests();
    _resetRestartOrchestratorInFlightForTests();
  });

  test('overlapping same-role task, operational, and periodic events produce one active plus one trailing pass', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_wake_1' });
    // Wake-eligible: pending + workingDir, operational model empty (stopped).
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, agentOperationalReadModel, process } = setupCoordinator(
      {
        backend,
      }
    );
    taskSnapshotState.replace([row]);

    const opRow = makeOperational(room, 'builder', {
      operationalState: 'stopped',
      revisionKey: 'rev_op',
    });
    const gate = deferred();
    let inFlight = 0;
    let maxInFlight = 0;
    const proc = process;
    const origEnsure = proc.ensureRunning;
    void origEnsure;
    proc.ensureRunning = ((op: EnsureRunningOpts) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          proc.ensureRunningCalls.push(op);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
        }),
        () => Effect.promise(() => gate.promise).pipe(Effect.as({ success: true as const })),
        () =>
          Effect.sync(() => {
            inFlight -= 1;
          })
      )) as (op: EnsureRunningOpts) => Effect.Effect<OperationResult>;

    const p1 = coordinator.accept({
      type: 'task-signal',
      update: makeTaskInboxUpdate(
        [makeTaskSignal(room, row.taskId as string, 'builder', 'pending', 's1')],
        [row]
      ),
    });
    const p2 = coordinator.accept({
      type: 'operational-signal',
      update: makeOperationalInboxUpdate(room, [opRow]),
    });
    const p3 = coordinator.accept({ type: 'periodic-reconcile' });
    // Give the event loop a chance to start the active pass and coalesce the rest.
    await new Promise((r) => setTimeout(r, 10));
    // All three events coalesced: exactly one active drain so far.
    expect(proc.ensureRunningCalls.length).toBeLessThanOrEqual(1);
    gate.resolve();
    await Promise.all([p1, p2, p3]);
    // One active pass plus exactly one trailing pass — no lost wakeups.
    expect(proc.ensureRunningCalls.length).toBe(2);
    expect(maxInFlight).toBe(1);
    // Read models were updated before reconciliation.
    expect(taskSnapshotState.listForRole(room, 'builder' as never).length).toBe(1);
    expect(agentOperationalReadModel.get(room, 'builder')).toMatchObject({ revisionKey: 'rev_op' });
  });

  test('different roles drain concurrently', async () => {
    silenceConsole();
    const room = nextRoom();
    const rowA = makeRow({
      chatroomId: room,
      role: 'alpha',
      taskId: 'task_a',
      assignedTo: 'alpha',
    });
    const rowB = makeRow({ chatroomId: room, role: 'beta', taskId: 'task_b', assignedTo: 'beta' });
    const backend = createFakeBackend(
      new Map([
        [rowA.taskId, makeFull(rowA)],
        [rowB.taskId, makeFull(rowB)],
      ])
    );
    const gateA = deferred();
    const proc = createFakeProcess({
      ensureRunningImpl: (op) =>
        op.role === 'alpha'
          ? Effect.promise(() => gateA.promise).pipe(Effect.as({ success: true as const }))
          : Effect.succeed({ success: true }),
    });
    const { coordinator, taskSnapshotState } = setupCoordinator({ process: proc, backend });
    taskSnapshotState.replace([rowA, rowB]);

    const pA = coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'alpha' });
    // Let A's drain start and block inside recovery.
    await vi.waitFor(() =>
      expect(proc.ensureRunningCalls.some((c) => c.role === 'alpha')).toBe(true)
    );
    const pB = coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'beta' });
    await pB;
    // B drained concurrently while A is still blocked.
    expect(proc.ensureRunningCalls.some((c) => c.role === 'beta')).toBe(true);
    gateA.resolve();
    await pA;
    expect(proc.ensureRunningCalls.filter((c) => c.role === 'alpha').length).toBe(1);
  });

  test('turn-idle is immediate and wins primary logging', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_primary' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(logSpy).toHaveBeenCalledWith(
      `[NativeDelivery:primary] turn idle builder@${room} — trying inject`
    );
    // A trailing agent-started pass falls back deterministically.
    expect(process.ensureRunningCalls.length).toBe(1);

    logSpy.mockClear();
    await coordinator.accept({ type: 'periodic-reconcile' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NativeDelivery:fallback] periodic-reconcile')
    );
  });

  test('pass containing turn-idle logs primary even when other reasons are present', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_mixed' });
    const gate = deferred();
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    backend.setQueryImpl(async (_fn, args) => {
      if ('convexUrl' in args) return { fullCliOutput: 'OUT' };
      if ('taskId' in args) {
        await gate.promise;
        return makeFull(row);
      }
      throw new Error('unexpected query');
    });
    const { coordinator, taskSnapshotState } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);

    const p1 = coordinator.accept({ type: 'agent-started', chatroomId: room, role: 'builder' });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    gate.resolve();
    await Promise.all([p1, p2]);
    const primary = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('[NativeDelivery:primary]')
    );
    expect(primary.length).toBe(1);
    expect(primary[0]?.[0]).toBe(
      `[NativeDelivery:primary] turn idle builder@${room} — trying inject`
    );
  });

  test('duplicate agent-started events coalesce into one trailing pass', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_dup' });
    const gate = deferred();
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    backend.setQueryImpl(async (_fn, args) => {
      if ('convexUrl' in args) return { fullCliOutput: 'OUT' };
      if ('taskId' in args) {
        await gate.promise;
        return makeFull(row);
      }
      throw new Error('unexpected query');
    });
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);

    const p1 = coordinator.accept({ type: 'agent-started', chatroomId: room, role: 'builder' });
    const p2 = coordinator.accept({ type: 'agent-started', chatroomId: room, role: 'builder' });
    const p3 = coordinator.accept({ type: 'agent-started', chatroomId: room, role: 'builder' });
    await new Promise((r) => setTimeout(r, 10));
    gate.resolve();
    await Promise.all([p1, p2, p3]);
    // One stuck-stop normalization per role/pass: exactly two passes total.
    expect(process.clearStuckCalls.length).toBe(2);
  });

  test('bootstrap replaces snapshot state and schedules represented roles', async () => {
    silenceConsole();
    const room = nextRoom();
    const stale = makeRow({ chatroomId: room, role: 'builder', taskId: 'task_stale' });
    const fresh = makeRow({ chatroomId: room, role: 'builder', taskId: 'task_fresh' });
    const backend = createFakeBackend(new Map([[fresh.taskId, makeFull(fresh)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([stale]);

    await coordinator.accept({ type: 'bootstrap', snapshots: [fresh] });
    expect(taskSnapshotState.listForRole(room, 'builder' as never).map((r) => r.taskId)).toEqual([
      'task_fresh',
    ]);
    // Reconciliation ran for the represented role (wake attempted for the fresh row).
    expect(process.ensureRunningCalls.length).toBe(1);
    expect(process.ensureRunningCalls[0]?.taskId).toBe('task_fresh');
  });

  test('task-signal applies signal page first, including removed snapshots', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_sig' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });

    await coordinator.accept({
      type: 'task-signal',
      update: makeTaskInboxUpdate(
        [makeTaskSignal(room, row.taskId as string, 'builder', 'pending', 's1')],
        [row]
      ),
    });
    expect(taskSnapshotState.listForRole(room, 'builder' as never).length).toBe(1);

    // Removed snapshot (signal without a row) still schedules the role.
    process.clearStuckCalls.length = 0;
    await coordinator.accept({
      type: 'task-signal',
      update: makeTaskInboxUpdate(
        [makeTaskSignal(room, 'task_gone', 'builder', 'completed', 's2')],
        []
      ),
    });
    expect(process.clearStuckCalls.length).toBe(1);
  });

  test('operational-signal applies signal page before reconciliation', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_ops' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, agentOperationalReadModel, process } = setupCoordinator(
      { backend }
    );
    taskSnapshotState.replace([row]);

    const opRow = makeOperational(room, 'builder', {
      operationalState: 'stopped',
      revisionKey: 'rev_ops_1',
    });
    await coordinator.accept({
      type: 'operational-signal',
      update: makeOperationalInboxUpdate(room, [opRow]),
    });
    expect(agentOperationalReadModel.get(room, 'builder')).toMatchObject({
      revisionKey: 'rev_ops_1',
    });
    // Operational stopped row + pending task → wake recovery attempted.
    expect(process.ensureRunningCalls.length).toBe(1);
  });

  test('session-lost clears ledger session and resets role state without delivery work', async () => {
    silenceConsole();
    const room = nextRoom();
    const ledger = getNativeDeliveryLedger();
    const deliveryState = getRoleDeliveryState();
    ledger.markDelivered('task_sl', 'sess_sl');
    const before = deliveryState.getGeneration(room, 'builder');
    const { coordinator, process } = setupCoordinator();

    await coordinator.accept({
      type: 'session-lost',
      chatroomId: room,
      role: 'builder',
      harnessSessionId: 'sess_sl',
    });
    expect(ledger.isDelivered('task_sl', 'sess_sl')).toBe(false);
    expect(deliveryState.getGeneration(room, 'builder')).toBe(before + 1);
    expect(process.clearStuckCalls.length).toBe(0);
    expect(process.ensureRunningCalls.length).toBe(0);
  });

  test('restart-reset resets role state without delivery work', async () => {
    silenceConsole();
    const room = nextRoom();
    const deliveryState = getRoleDeliveryState();
    const ledger = getNativeDeliveryLedger();
    ledger.markDelivered('task_rr', 'sess_rr');
    const before = deliveryState.getGeneration(room, 'builder');
    const { coordinator, process } = setupCoordinator();

    await coordinator.accept({ type: 'restart-reset', chatroomId: room, role: 'builder' });
    expect(deliveryState.getGeneration(room, 'builder')).toBe(before + 1);
    // restart-reset does not clear ledger sessions.
    expect(ledger.isDelivered('task_rr', 'sess_rr')).toBe(true);
    expect(process.clearStuckCalls.length).toBe(0);
  });

  test('recovery failure does not poison later drains', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_fail' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    let attempts = 0;
    const proc = createFakeProcess({
      ensureRunningImpl: () => {
        attempts += 1;
        return attempts === 1 ? Effect.fail(new Error('boom')) : Effect.succeed({ success: true });
      },
    });
    const { coordinator, taskSnapshotState } = setupCoordinator({ process: proc, backend });
    taskSnapshotState.replace([row]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(attempts).toBe(2);
    expect(proc.ensureRunningCalls.length).toBe(2);
  });

  test('injection failure releases ledger and permits retry', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_injfail' });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_inj',
      nativeTurnPhase: 'idle',
    });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    backend.setQueryImpl(async (_fn, args) => {
      if ('convexUrl' in args) throw new Error('prompt exploded');
      if ('taskId' in args) return makeFull(row);
      throw new Error('unexpected query');
    });
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    const ledger = getNativeDeliveryLedger();
    expect(ledger.isAttemptInFlight(row.taskId)).toBe(false);
    expect(proc.resumeCalls.length).toBe(0);

    backend.setQueryImpl(async (_fn, args) => {
      if ('convexUrl' in args) return { fullCliOutput: 'OUT' };
      if ('taskId' in args) return makeFull(row);
      throw new Error('unexpected query');
    });
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.resumeCalls.length).toBe(1);
    expect(ledger.isDelivered(row.taskId, 'sess_inj')).toBe(true);
  });

  test('stop settles active drains and ignores new work', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_stop' });
    const gate = deferred();
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    backend.setQueryImpl(async (_fn, args) => {
      if ('convexUrl' in args) return { fullCliOutput: 'OUT' };
      if ('taskId' in args) {
        await gate.promise;
        return makeFull(row);
      }
      throw new Error('unexpected query');
    });
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);

    const active = coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    await new Promise((r) => setTimeout(r, 10));
    const stopping = coordinator.stop();
    gate.resolve();
    await Promise.all([active, stopping]);
    const callsAfterStop = process.clearStuckCalls.length;
    expect(callsAfterStop).toBe(1);

    // New events after stop are ignored.
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    await coordinator.accept({ type: 'periodic-reconcile' });
    expect(process.clearStuckCalls.length).toBe(callsAfterStop);
  });

  test('one stuck-stop normalization per role per pass', async () => {
    silenceConsole();
    const room = nextRoom();
    const rowA = makeRow({ chatroomId: room, taskId: 'task_n1', createdAt: 1 });
    const rowB = makeRow({ chatroomId: room, taskId: 'task_n2', createdAt: 2 });
    const backend = createFakeBackend(
      new Map([
        [rowA.taskId, makeFull(rowA)],
        [rowB.taskId, makeFull(rowB)],
      ])
    );
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([rowA, rowB]);

    await coordinator.accept({ type: 'periodic-reconcile' });
    expect(process.clearStuckCalls.length).toBe(1);
  });

  test('cooldown suppresses repeated recovery attempts', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_cd' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({
      backend,
      cooldownMs: 60_000,
    });
    taskSnapshotState.replace([row]);

    await coordinator.accept({ type: 'periodic-reconcile' });
    await coordinator.accept({ type: 'periodic-reconcile' });
    expect(process.ensureRunningCalls.length).toBe(1);
  });

  test('delivery orders pending first and injects one task at a time', async () => {
    silenceConsole();
    const room = nextRoom();
    const ack = makeRow({
      chatroomId: room,
      role: 'builder',
      taskId: 'task_ack_old',
      status: 'acknowledged',
      createdAt: 1,
    });
    const pending = makeRow({
      chatroomId: room,
      role: 'builder',
      taskId: 'task_pending_new',
      status: 'pending',
      createdAt: 2,
    });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_ord',
      nativeTurnPhase: 'idle',
    });
    const backend = createFakeBackend(
      new Map([
        [ack.taskId, makeFull(ack)],
        [pending.taskId, makeFull(pending)],
      ])
    );
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([ack, pending]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    // Pending sorts before acknowledged; exactly one injection per pass.
    expect(proc.setLastInFlightCalls).toEqual([
      { chatroomId: room, role: 'builder', taskId: 'task_pending_new' },
    ]);
    expect(proc.resumeCalls.length).toBe(1);
  });

  test('stale turn phase is repaired before delivery', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_stale_turn' });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_stale',
      nativeTurnPhase: 'turn_in_flight',
    });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.reconcileTurnCalls).toEqual([{ chatroomId: room, role: 'builder' }]);
    expect(proc.resumeCalls.length).toBe(1);
  });

  test('ledger block skips injection without losing the task', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_ledger' });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_led',
      nativeTurnPhase: 'idle',
    });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    const ledger = getNativeDeliveryLedger();
    expect(ledger.tryAcquire(row.taskId, 'sess_led')).toBe(true);
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.resumeCalls.length).toBe(0);

    ledger.releaseAttempt(row.taskId);
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.resumeCalls.length).toBe(1);
  });

  test('role mutex block releases the ledger attempt and permits retry', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_mutex' });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_mut',
      nativeTurnPhase: 'idle',
    });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    const deliveryState = getRoleDeliveryState();
    expect(deliveryState.tryAcquireDelivery(room, 'builder')).toBe(true);
    try {
      await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
      expect(proc.resumeCalls.length).toBe(0);
      expect(getNativeDeliveryLedger().isAttemptInFlight(row.taskId)).toBe(false);
    } finally {
      deliveryState.releaseDelivery(room, 'builder');
    }
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.resumeCalls.length).toBe(1);
  });

  test('deleted task hydrate guard skips injection and releases reservations', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_deleted' });
    const proc = createFakeProcess();
    proc.slots.set(slotKey(room, 'builder'), {
      state: 'running',
      pid: 42_424,
      harnessSessionId: 'sess_del',
      nativeTurnPhase: 'idle',
    });
    // No full task registered → hydrate returns null (deleted or not assigned).
    const backend = createFakeBackend(new Map());
    const { coordinator, taskSnapshotState, agentOperationalReadModel } = setupCoordinator({
      process: proc,
      backend,
    });
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(proc.resumeCalls.length).toBe(0);
    expect(getNativeDeliveryLedger().isAttemptInFlight(row.taskId)).toBe(false);
  });

  test('revive path starts agents with stale local processes', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_revive' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    // Operational running, but no local slot → revive.
    const { coordinator, taskSnapshotState, agentOperationalReadModel, process } = setupCoordinator(
      {
        backend,
      }
    );
    taskSnapshotState.replace([row]);
    agentOperationalReadModel.replace([makeOperational(room, 'builder')]);

    await coordinator.accept({ type: 'periodic-reconcile' });
    expect(process.ensureRunningCalls.length).toBe(1);
    expect(String(process.ensureRunningCalls[0]?.reason)).toContain('task_monitor_nudge');
  });

  test('restart-in-flight roles are suppressed', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, taskId: 'task_restart' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);
    markRestartOrchestratorInFlight(room, 'builder', 'corr-1');

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    expect(process.ensureRunningCalls.length).toBe(0);
    expect(process.clearStuckCalls.length).toBe(0);
    expect(process.resumeCalls.length).toBe(0);
  });

  test('role keys are case-insensitive and collision-safe', async () => {
    silenceConsole();
    const room = nextRoom();
    const row = makeRow({ chatroomId: room, role: 'Builder', taskId: 'task_case' });
    const backend = createFakeBackend(new Map([[row.taskId, makeFull(row)]]));
    const { coordinator, taskSnapshotState, process } = setupCoordinator({ backend });
    taskSnapshotState.replace([row]);

    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'builder' });
    await coordinator.accept({ type: 'turn-idle', chatroomId: room, role: 'BUILDER' });
    // Same role key → both drains ran through the same per-role scheduler.
    expect(process.ensureRunningCalls.length).toBe(2);
  });
});
